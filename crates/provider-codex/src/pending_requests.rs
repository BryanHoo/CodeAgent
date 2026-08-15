use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use code_agent_core::{AgentMutationErrorCode, CodeAgentError, CodeAgentErrorCode};
use serde_json::{Map, Value, json};

use crate::PendingCodexRequest;

const MAX_PENDING: usize = 1_000;
const MAX_TERMINAL: usize = 1_000;

#[derive(Clone)]
pub(crate) struct PreparedResolution {
    pub answer_item: Option<Value>,
    pub entry: PendingCodexRequest,
    pub fingerprint: String,
    pub native: Value,
}

pub(crate) enum PrepareOutcome {
    Ready(PreparedResolution),
    Reused(Value),
}

#[derive(Clone)]
struct TerminalRequest {
    entry: PendingCodexRequest,
    fingerprint: Option<String>,
    request: Value,
}

#[derive(Default)]
struct State {
    pending: HashMap<String, PendingCodexRequest>,
    resolving: HashMap<String, String>,
    terminal: HashMap<String, TerminalRequest>,
    terminal_order: VecDeque<String>,
}

#[derive(Default)]
pub(crate) struct PendingRequestRegistry {
    state: Mutex<State>,
}

impl PendingRequestRegistry {
    pub(crate) fn activate(&self, entry: PendingCodexRequest) -> Result<bool, CodeAgentError> {
        let request_id = request_id(&entry.request)?.to_owned();
        let mut state = self.lock()?;
        if state.pending.contains_key(&request_id) || state.terminal.contains_key(&request_id) {
            return Ok(false);
        }
        if state.pending.len() >= MAX_PENDING {
            return Err(capacity("pending request capacity exceeded"));
        }
        state.pending.insert(request_id, entry);
        Ok(true)
    }

    pub(crate) fn snapshot(&self) -> HashMap<String, PendingCodexRequest> {
        self.state
            .lock()
            .map(|state| state.pending.clone())
            .unwrap_or_default()
    }

    pub(crate) fn contains_task(&self, task_id: &str) -> bool {
        self.state.lock().is_ok_and(|state| {
            state
                .pending
                .values()
                .any(|entry| entry.request["taskId"] == task_id)
                || state.terminal.values().any(|entry| {
                    entry.request["taskId"] == task_id && entry.request["status"] == "pending"
                })
        })
    }

    pub(crate) fn prepare(
        &self,
        input: &Value,
        project_id: &str,
    ) -> Result<PrepareOutcome, CodeAgentError> {
        let request_id = string(input, "requestId")?;
        let mut state = self.lock()?;
        if let Some(terminal) = state.terminal.get(request_id) {
            validate_identity(&terminal.request, input, project_id)?;
            if terminal.request["status"] == "expired" {
                return Err(conflict("pending request already expired")
                    .with_mutation_code(AgentMutationErrorCode::PendingRequestExpired));
            }
            let (native, _) = map_resolution(&terminal.entry, input)?;
            let fingerprint = serde_json::to_string(&native)
                .map_err(|error| CodeAgentError::internal(error.to_string()))?;
            return if terminal.fingerprint.as_deref() == Some(&fingerprint) {
                Ok(PrepareOutcome::Reused(terminal.request.clone()))
            } else {
                Err(
                    conflict("pending request already resolved with another response")
                        .with_mutation_code(AgentMutationErrorCode::PendingRequestAlreadyResolved),
                )
            };
        }
        let entry = state.pending.get(request_id).cloned().ok_or_else(|| {
            not_found("pending request was not found")
                .with_mutation_code(AgentMutationErrorCode::PendingRequestNotFound)
        })?;
        validate_identity(&entry.request, input, project_id)?;
        let (native, answer_item) = map_resolution(&entry, input)?;
        let fingerprint = serde_json::to_string(&native)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        if let Some(active) = state.resolving.get(request_id) {
            let message = if active == &fingerprint {
                "pending request resolution is in progress"
            } else {
                "pending request is resolving with another response"
            };
            return Err(conflict(message)
                .with_mutation_code(AgentMutationErrorCode::PendingRequestAlreadyResolved));
        }
        state
            .resolving
            .insert(request_id.to_owned(), fingerprint.clone());
        Ok(PrepareOutcome::Ready(PreparedResolution {
            answer_item,
            entry,
            fingerprint,
            native,
        }))
    }

    pub(crate) fn rollback(&self, request_id: &str, fingerprint: &str) {
        if let Ok(mut state) = self.state.lock()
            && state
                .resolving
                .get(request_id)
                .is_some_and(|value| value == fingerprint)
        {
            state.resolving.remove(request_id);
        }
    }

    pub(crate) fn complete(
        &self,
        prepared: PreparedResolution,
        status: &'static str,
    ) -> Result<Vec<Value>, CodeAgentError> {
        let id = request_id(&prepared.entry.request)?.to_owned();
        let mut state = self.lock()?;
        if state.resolving.get(&id) != Some(&prepared.fingerprint) {
            return Err(conflict("pending request resolution changed")
                .with_mutation_code(AgentMutationErrorCode::PendingRequestAlreadyResolved));
        }
        state.resolving.remove(&id);
        let Some(entry) = state.pending.remove(&id) else {
            return Ok(Vec::new());
        };
        terminalize(&mut state, &id, &entry, status, Some(prepared.fingerprint));
        Ok(events(&entry.request, status, prepared.answer_item))
    }

    pub(crate) fn expire_turn(&self, task_id: &str, turn_id: &str) -> Vec<Value> {
        self.expire_matching(|request| request["taskId"] == task_id && request["turnId"] == turn_id)
    }

    pub(crate) fn resolve_native(&self, request_id: &str, task_id: &str) -> Vec<Value> {
        self.expire_matching(|request| {
            request["requestId"] == request_id && request["taskId"] == task_id
        })
    }

    pub(crate) fn expire_request(&self, request_id: &str) -> Option<Vec<Value>> {
        let mut state = self.state.lock().ok()?;
        if state.resolving.contains_key(request_id) {
            return None;
        }
        let entry = state.pending.remove(request_id)?;
        terminalize(&mut state, request_id, &entry, "expired", None);
        Some(events(&entry.request, "expired", None))
    }

    pub(crate) fn clear_task(&self, task_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            let ids = state
                .pending
                .iter()
                .filter(|(_, entry)| entry.request["taskId"] == task_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in ids {
                state.pending.remove(&id);
                state.resolving.remove(&id);
            }
            let terminal_ids = state
                .terminal
                .iter()
                .filter(|(_, terminal)| terminal.request["taskId"] == task_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in terminal_ids {
                state.terminal.remove(&id);
                state.terminal_order.retain(|candidate| candidate != &id);
            }
        }
    }

    fn expire_matching(&self, predicate: impl Fn(&Value) -> bool) -> Vec<Value> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        let ids = state
            .pending
            .iter()
            .filter(|(id, entry)| !state.resolving.contains_key(*id) && predicate(&entry.request))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let mut output = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(entry) = state.pending.remove(&id) {
                terminalize(&mut state, &id, &entry, "expired", None);
                output.extend(events(&entry.request, "expired", None));
            }
        }
        output
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, State>, CodeAgentError> {
        self.state
            .lock()
            .map_err(|_| CodeAgentError::internal("pending request registry is poisoned"))
    }
}

fn validate_identity(
    request: &Value,
    input: &Value,
    project_id: &str,
) -> Result<(), CodeAgentError> {
    for key in ["taskId", "turnId", "itemId", "type"] {
        if request[key] != input[key] {
            return Err(conflict("pending request identity does not match")
                .with_mutation_code(AgentMutationErrorCode::PendingRequestMismatch));
        }
    }
    if request["projectId"] != project_id || input["projectId"] != project_id {
        return Err(conflict("pending request project does not match")
            .with_mutation_code(AgentMutationErrorCode::PendingRequestMismatch));
    }
    Ok(())
}

fn map_resolution(
    entry: &PendingCodexRequest,
    input: &Value,
) -> Result<(Value, Option<Value>), CodeAgentError> {
    let request = &entry.request;
    if request["type"] == "user_input" {
        let answers = input
            .pointer("/resolution/answers")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("user input answers are invalid"))?;
        validate_answers(request, answers)?;
        let native = request["questions"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|question| question["id"].as_str())
            .map(|id| (id.to_owned(), json!({ "answers": answers[id] })))
            .collect::<Map<_, _>>();
        return Ok((
            json!({ "answers": native }),
            Some(answer_item(request, answers)),
        ));
    }
    if request["type"] == "permissions_approval" {
        let permissions = input
            .pointer("/resolution/permissions")
            .ok_or_else(|| invalid("permission resolution is invalid"))?;
        validate_permission_subset(&request["permissions"], permissions)?;
        let scope = input
            .pointer("/resolution/scope")
            .and_then(Value::as_str)
            .filter(|scope| matches!(*scope, "turn" | "session"))
            .ok_or_else(|| invalid("permission resolution scope is invalid"))?;
        return Ok((
            json!({
                "permissions": native_permission_grant(permissions),
                "scope": scope
            }),
            None,
        ));
    }
    let decision = input
        .pointer("/resolution/decision")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("approval decision is invalid"))?;
    if !request["availableDecisions"]
        .as_array()
        .is_some_and(|values| values.iter().any(|value| value == decision))
    {
        return Err(conflict("approval decision is unavailable")
            .with_mutation_code(AgentMutationErrorCode::PendingRequestMismatch));
    }
    let native = match decision {
        "allow" => "accept",
        "allow_for_session" => "acceptForSession",
        "deny" => entry.deny_decision.unwrap_or("decline"),
        _ => return Err(invalid("approval decision is invalid")),
    };
    Ok((json!({ "decision": native }), None))
}

fn validate_permission_subset(requested: &Value, granted: &Value) -> Result<(), CodeAgentError> {
    for key in ["network", "fileSystem"] {
        let grant = &granted[key];
        if grant.is_null() {
            continue;
        }
        let request = &requested[key];
        if request.is_null() {
            return Err(permission_mismatch());
        }
        if key == "network" {
            if grant != request {
                return Err(permission_mismatch());
            }
        } else {
            validate_file_system_subset(request, grant)?;
        }
    }
    Ok(())
}

fn validate_file_system_subset(requested: &Value, granted: &Value) -> Result<(), CodeAgentError> {
    if granted["globScanMaxDepth"] != requested["globScanMaxDepth"] {
        return Err(permission_mismatch());
    }
    for key in ["read", "write", "entries"] {
        let selected = &granted[key];
        if selected.is_null() {
            continue;
        }
        let available = requested[key].as_array().ok_or_else(permission_mismatch)?;
        let selected = selected.as_array().ok_or_else(permission_mismatch)?;
        if selected
            .iter()
            .any(|candidate| !available.iter().any(|value| value == candidate))
        {
            return Err(permission_mismatch());
        }
    }
    Ok(())
}

fn native_permission_grant(permissions: &Value) -> Value {
    let mut native = Map::new();
    if !permissions["network"].is_null() {
        native.insert("network".to_string(), permissions["network"].clone());
    }
    if let Some(file_system) = permissions["fileSystem"].as_object() {
        let mut selected = Map::new();
        for key in ["read", "write"] {
            selected.insert(key.to_string(), file_system[key].clone());
        }
        for key in ["globScanMaxDepth", "entries"] {
            if !file_system[key].is_null() {
                selected.insert(key.to_string(), file_system[key].clone());
            }
        }
        native.insert("fileSystem".to_string(), Value::Object(selected));
    }
    Value::Object(native)
}

fn permission_mismatch() -> CodeAgentError {
    conflict("granted permissions exceed the requested permissions")
        .with_mutation_code(AgentMutationErrorCode::PendingRequestMismatch)
}

fn validate_answers(request: &Value, answers: &Map<String, Value>) -> Result<(), CodeAgentError> {
    let questions = request["questions"]
        .as_array()
        .ok_or_else(|| invalid("pending questions are invalid"))?;
    if answers.len() != questions.len() {
        return Err(conflict("user input answers do not match questions")
            .with_mutation_code(AgentMutationErrorCode::PendingRequestMismatch));
    }
    for question in questions {
        let id = string(question, "id")?;
        let answer = answers
            .get(id)
            .and_then(Value::as_array)
            .filter(|values| values.len() == 1)
            .and_then(|values| values[0].as_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| conflict("user input answer is invalid"))?;
        let options = question["options"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        if !options.is_empty()
            && question["isOther"] != true
            && !options.iter().any(|option| option["label"] == answer)
        {
            return Err(conflict("user input answer is unavailable")
                .with_mutation_code(AgentMutationErrorCode::PendingRequestMismatch));
        }
    }
    Ok(())
}

fn answer_item(request: &Value, answers: &Map<String, Value>) -> Value {
    let text = request["questions"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|question| {
            let id = question["id"].as_str().unwrap_or_default();
            let answer = if question["isSecret"] == true {
                "******"
            } else {
                answers[id]
                    .as_array()
                    .and_then(|values| values[0].as_str())
                    .unwrap_or_default()
            };
            format!(
                "- {}: {answer}",
                question["header"].as_str().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    json!({ "id": format!("user-input-answer-{}", request["requestId"].as_str().unwrap_or_default()), "role": "user", "text": text, "type": "message" })
}

fn events(request: &Value, status: &str, answer: Option<Value>) -> Vec<Value> {
    let mut terminal = request.clone();
    terminal["status"] = Value::String(status.to_owned());
    let mut result = vec![
        json!({ "itemId": request["itemId"], "payload": { "request": terminal }, "taskId": request["taskId"], "turnId": request["turnId"], "type": format!("pending_request.{status}") }),
    ];
    if let Some(item) = answer {
        result.push(json!({ "itemId": item["id"], "payload": { "item": item }, "taskId": request["taskId"], "turnId": request["turnId"], "type": "item.completed" }));
    }
    result
}

fn terminalize(
    state: &mut State,
    id: &str,
    entry: &PendingCodexRequest,
    status: &str,
    fingerprint: Option<String>,
) {
    let mut request = entry.request.clone();
    request["status"] = Value::String(status.to_owned());
    state.terminal.insert(
        id.to_owned(),
        TerminalRequest {
            entry: entry.clone(),
            fingerprint,
            request,
        },
    );
    state.terminal_order.push_back(id.to_owned());
    while state.terminal_order.len() > MAX_TERMINAL {
        if let Some(oldest) = state.terminal_order.pop_front() {
            state.terminal.remove(&oldest);
        }
    }
}

fn request_id(value: &Value) -> Result<&str, CodeAgentError> {
    string(value, "requestId")
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CodeAgentError> {
    value[key]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("pending request field is invalid"))
}
fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}
fn conflict(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::Conflict, message, None)
}
fn not_found(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::NotFound, message, None)
}
fn capacity(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::CapacityExceeded, message, None)
}
