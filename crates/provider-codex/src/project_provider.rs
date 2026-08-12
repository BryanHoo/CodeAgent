use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use chrono::{DateTime, SecondsFormat};
use code_agent_core::{CodeAgentError, PortRequestContext, ProjectProviderPort};
use code_agent_protocol::{
    AgentBackgroundTerminalPage, AgentMcpServerPage, AgentSkillPage, AgentTaskPage, Project,
    RawProviderEvent, ValueDefinition, parse_protocol_value,
};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::{
    JsonlRpcClient, PendingCodexRequest, RpcServerRequest, map_codex_server_request,
    map_codex_turn, rpc_error_to_code_agent_error, skill_mapping::map_skills,
};

const EVENT_SUBSCRIBER_CAPACITY: usize = 256;
const MAX_PENDING_REQUESTS: usize = 1_000;

struct Subscriber {
    include_ephemeral: bool,
    sender: mpsc::Sender<RawProviderEvent>,
}

pub(crate) struct CodexProjectProvider {
    client: JsonlRpcClient,
    ephemeral: Mutex<HashSet<String>>,
    owners: Arc<Mutex<HashMap<String, String>>>,
    pending: Mutex<HashMap<String, PendingCodexRequest>>,
    project: Project,
    resume_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    resumed: Mutex<HashSet<String>>,
    subscribers: Mutex<Vec<Subscriber>>,
    tasks: Mutex<HashSet<String>>,
}

impl CodexProjectProvider {
    pub(crate) fn new(
        client: JsonlRpcClient,
        project: Project,
        owners: Arc<Mutex<HashMap<String, String>>>,
    ) -> Self {
        Self {
            client,
            ephemeral: Mutex::new(HashSet::new()),
            owners,
            pending: Mutex::new(HashMap::new()),
            project,
            resume_locks: Mutex::new(HashMap::new()),
            resumed: Mutex::new(HashSet::new()),
            subscribers: Mutex::new(Vec::new()),
            tasks: Mutex::new(HashSet::new()),
        }
    }

    pub(crate) fn root_path(&self) -> &str {
        self.project.root_path.as_str()
    }

    async fn rpc(&self, method: &str, params: Option<Value>) -> Result<Value, CodeAgentError> {
        self.client
            .request(method, params)
            .await
            .map_err(|error| rpc_error_to_code_agent_error(&error))
    }

    fn claim_task(&self, task_id: &str, ephemeral: bool) -> Result<(), CodeAgentError> {
        let project_id = self.project.id.to_string();
        let mut owners = self
            .owners
            .lock()
            .map_err(|_| CodeAgentError::internal("provider owner registry is poisoned"))?;
        if let Some(owner) = owners.get(task_id)
            && owner != &project_id
        {
            return Err(CodeAgentError::internal(
                "Codex thread belongs to another project",
            ));
        }
        owners.insert(task_id.to_string(), project_id);
        self.tasks
            .lock()
            .map_err(|_| CodeAgentError::internal("provider task registry is poisoned"))?
            .insert(task_id.to_string());
        if ephemeral {
            self.ephemeral
                .lock()
                .map_err(|_| CodeAgentError::internal("provider task registry is poisoned"))?
                .insert(task_id.to_string());
        }
        Ok(())
    }

    fn assert_task(&self, task_id: &str) -> Result<(), CodeAgentError> {
        if self
            .tasks
            .lock()
            .map(|tasks| tasks.contains(task_id))
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err(CodeAgentError::internal(
                "Codex thread does not belong to the active project",
            ))
        }
    }

    async fn resume(&self, task_id: &str) -> Result<(), CodeAgentError> {
        if self
            .resumed
            .lock()
            .map(|tasks| tasks.contains(task_id))
            .unwrap_or(false)
        {
            return Ok(());
        }
        let lock = self
            .resume_locks
            .lock()
            .map_err(|_| CodeAgentError::internal("resume registry is poisoned"))?
            .entry(task_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        let _guard = lock.lock().await;
        if self
            .resumed
            .lock()
            .map(|tasks| tasks.contains(task_id))
            .unwrap_or(false)
        {
            return Ok(());
        }
        let response = self
            .rpc("thread/resume", Some(json!({ "threadId": task_id })))
            .await?;
        if response["thread"]["id"] != task_id {
            return Err(CodeAgentError::internal(
                "thread/resume returned a different thread",
            ));
        }
        self.resumed
            .lock()
            .map_err(|_| CodeAgentError::internal("resume registry is poisoned"))?
            .insert(task_id.to_string());
        Ok(())
    }

    pub(crate) async fn publish(&self, event: RawProviderEvent) {
        let ephemeral = self
            .ephemeral
            .lock()
            .map(|tasks| tasks.contains(event.task_id()))
            .unwrap_or(false);
        if let Ok(mut subscribers) = self.subscribers.lock() {
            // 满队列代表消费者已落后；直接淘汰，禁止阻塞 Provider 入站流。
            subscribers.retain(|subscriber| {
                if ephemeral && !subscriber.include_ephemeral {
                    return !subscriber.sender.is_closed();
                }
                subscriber.sender.try_send(event.clone()).is_ok()
            });
        }
    }

    pub(crate) async fn publish_failure(&self) {
        let tasks = self
            .tasks
            .lock()
            .map(|tasks| tasks.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for task_id in tasks {
            if let Ok(event) = code_agent_protocol::parse_provider_event(json!({
                "payload": { "code": "connection_failed", "message": "Codex App Server exited", "willRetry": false },
                "taskId": task_id,
                "turnId": "provider",
                "type": "provider.error"
            })) {
                self.publish(event).await;
            }
        }
    }

    pub(crate) async fn receive_server_request(&self, request: RpcServerRequest) {
        let now = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now());
        match map_codex_server_request(&request, self.project.id.as_str(), now) {
            Ok(Some(pending)) => {
                let key = pending.request["requestId"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                let inserted = self.pending.lock().is_ok_and(|mut requests| {
                    if requests.len() >= MAX_PENDING_REQUESTS {
                        return false;
                    }
                    requests.insert(key, pending.clone());
                    true
                });
                if !inserted {
                    let _ = self
                        .client
                        .reject_server_request(
                            request.id,
                            -32000,
                            "Pending request capacity exceeded",
                        )
                        .await;
                    return;
                }
                if let Ok(event) = code_agent_protocol::parse_provider_event(json!({
                    "itemId": pending.request["itemId"], "payload": { "request": pending.request },
                    "taskId": pending.request["taskId"], "turnId": pending.request["turnId"], "type": "pending_request.created"
                })) {
                    self.publish(event).await;
                }
            }
            _ => {
                let _ = self
                    .client
                    .reject_server_request(request.id, -32602, "Invalid provider request")
                    .await;
            }
        }
    }
}

fn map_task(thread: &Value, project_id: &str) -> Result<Value, CodeAgentError> {
    let id = thread
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CodeAgentError::internal("Codex thread id is invalid"))?;
    let timestamp = thread
        .get("updatedAt")
        .and_then(Value::as_i64)
        .and_then(|seconds| DateTime::from_timestamp(seconds, 0))
        .ok_or_else(|| CodeAgentError::internal("Codex thread updatedAt is invalid"))?;
    let title = thread
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            thread
                .get("preview")
                .and_then(Value::as_str)
                .and_then(|value| value.lines().next())
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("新聊天");
    Ok(json!({
        "id": id,
        "pinned": thread.get("section").and_then(Value::as_str) == Some("pinned"),
        "projectId": project_id,
        "title": title,
        "updatedAt": timestamp.to_rfc3339_opts(SecondsFormat::Millis, true)
    }))
}

#[async_trait]
impl ProjectProviderPort for CodexProjectProvider {
    async fn start_task(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let ephemeral = input
            .get("ephemeral")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let response = self
            .rpc(
                "thread/start",
                Some(json!({ "cwd": self.project.root_path.as_str(), "ephemeral": ephemeral })),
            )
            .await?;
        let task = map_task(&response["thread"], self.project.id.as_str())?;
        self.claim_task(task["id"].as_str().unwrap_or_default(), ephemeral)?;
        self.resumed
            .lock()
            .map_err(|_| CodeAgentError::internal("resume registry is poisoned"))?
            .insert(task["id"].as_str().unwrap_or_default().to_string());
        Ok(task)
    }

    async fn list_tasks(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        let mut params = json!({ "cwd": self.project.root_path.as_str(), "sortDirection": "desc", "sortKey": "updated_at" });
        if let Some(cursor) = input.get("cursor") {
            params["cursor"] = cursor.clone();
        }
        if let Some(limit) = input.get("limit") {
            params["limit"] = limit.clone();
        }
        let response = self.rpc("thread/list", Some(params)).await?;
        let data = response
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| CodeAgentError::internal("thread/list data is invalid"))?
            .iter()
            .map(|thread| map_task(thread, self.project.id.as_str()))
            .collect::<Result<Vec<_>, _>>()?;
        for task in &data {
            self.claim_task(task["id"].as_str().unwrap_or_default(), false)?;
        }
        serde_json::from_value(json!({ "data": data, "nextCursor": response.get("nextCursor").cloned().unwrap_or(Value::Null) })).map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn read_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        let response = self
            .rpc(
                "thread/read",
                Some(json!({ "includeTurns": true, "threadId": task_id })),
            )
            .await?;
        let thread = &response["thread"];
        if thread.get("cwd").and_then(Value::as_str) != Some(self.project.root_path.as_str()) {
            return Ok(None);
        }
        self.claim_task(task_id, false)?;
        let turns = thread
            .get("turns")
            .and_then(Value::as_array)
            .map(|turns| {
                turns
                    .iter()
                    .map(map_codex_turn)
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()
            .map_err(|error| CodeAgentError::internal(error.to_string()))?
            .unwrap_or_default();
        let mut snapshot = map_task(thread, self.project.id.as_str())?;
        snapshot["contextUsage"] = Value::Null;
        snapshot["pendingRequests"] = json!([]);
        snapshot["plan"] = Value::Null;
        snapshot["status"] = Value::String("idle".to_string());
        snapshot["turns"] = json!(turns);
        Ok(Some(
            parse_protocol_value(ValueDefinition::AgentTaskSnapshot, snapshot)
                .map_err(|error| CodeAgentError::internal(error.to_string()))?,
        ))
    }

    async fn pin_task(
        &self,
        task_id: &str,
        pinned: bool,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc("thread/section/move", Some(json!({ "sectionId": if pinned { Value::String("pinned".to_string()) } else { Value::Null }, "threadId": task_id }))).await?;
        let response = self
            .rpc(
                "thread/read",
                Some(json!({ "includeTurns": false, "threadId": task_id })),
            )
            .await?;
        map_task(&response["thread"], self.project.id.as_str())
    }
    async fn rename_task(
        &self,
        task_id: &str,
        title: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc(
            "thread/name/set",
            Some(json!({ "name": title, "threadId": task_id })),
        )
        .await
        .map(|_| ())
    }
    async fn archive_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc("thread/archive", Some(json!({ "threadId": task_id })))
            .await
            .map(|_| ())
    }
    async fn fork_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc("thread/fork", Some(json!({ "threadId": task_id })))
            .await?;
        let task = map_task(&response["thread"], self.project.id.as_str())?;
        self.claim_task(task["id"].as_str().unwrap_or_default(), false)?;
        Ok(task)
    }
    async fn compact_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc("thread/compact/start", Some(json!({ "threadId": task_id })))
            .await
            .map(|_| ())
    }
    async fn unsubscribe_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc("thread/unsubscribe", Some(json!({ "threadId": task_id })))
            .await?;
        Ok(response["status"]
            .as_str()
            .unwrap_or("notLoaded")
            .to_string())
    }

    async fn start_turn(
        &self,
        task_id: &str,
        mut input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.assert_task(task_id)?;
        self.resume(task_id).await?;
        input["threadId"] = Value::String(task_id.to_string());
        let response = self.rpc("turn/start", Some(input)).await?;
        map_codex_turn(&response["turn"])
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn steer_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc(
            "turn/steer",
            Some(
                json!({ "expectedTurnId": turn_id, "input": input["input"], "threadId": task_id }),
            ),
        )
        .await
        .map(|_| ())
    }
    async fn interrupt_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc(
            "turn/interrupt",
            Some(json!({ "threadId": task_id, "turnId": turn_id })),
        )
        .await
        .map(|_| ())
    }
    async fn start_review(
        &self,
        task_id: &str,
        target: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc(
                "review/start",
                Some(json!({ "delivery": "inline", "target": target, "threadId": task_id })),
            )
            .await?;
        map_codex_turn(&response["turn"])
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn resolve_pending_request(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let request_id = input
            .get("requestId")
            .and_then(Value::as_str)
            .ok_or_else(|| CodeAgentError::internal("pending request id is invalid"))?;
        let pending = self
            .pending
            .lock()
            .map_err(|_| CodeAgentError::internal("pending registry is poisoned"))?
            .remove(request_id)
            .ok_or_else(|| CodeAgentError::internal("pending request is unavailable"))?;
        let decision = input
            .get("decision")
            .and_then(Value::as_str)
            .unwrap_or("deny");
        let native = match decision {
            "allow" => "accept",
            "allow_for_session" => "acceptForSession",
            _ => pending.deny_decision.unwrap_or("decline"),
        };
        self.client
            .respond_to_server_request(pending.provider_request_id, json!({ "decision": native }))
            .await
            .map_err(|error| rpc_error_to_code_agent_error(&error))?;
        let mut resolved = pending.request;
        resolved["status"] = Value::String("resolved".to_string());
        Ok(resolved)
    }

    async fn list_skills(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        let response = self
            .rpc(
                "skills/list",
                Some(json!({ "cwds": [self.project.root_path.as_str()], "forceReload": false })),
            )
            .await?;
        map_skills(&response, self.project.root_path.as_str())
    }
    async fn list_mcp_servers(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.assert_task(task_id)?;
        self.resume(task_id).await?;
        let response = self
            .rpc("mcpServerStatus/list", Some(json!({ "threadId": task_id })))
            .await?;
        serde_json::from_value(response)
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn reload_mcp_servers(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc("config/mcpServer/reload", None).await?;
        self.list_mcp_servers(task_id, context).await
    }
    async fn list_background_terminals(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc(
                "thread/backgroundTerminals/list",
                Some(json!({ "limit": 100, "threadId": task_id })),
            )
            .await?;
        serde_json::from_value(response)
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn terminate_background_terminal(
        &self,
        task_id: &str,
        terminal_id: &str,
        _context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc(
                "thread/backgroundTerminals/terminate",
                Some(json!({ "processId": terminal_id, "threadId": task_id })),
            )
            .await?;
        Ok(response["terminated"].as_bool().unwrap_or(false))
    }
    async fn upload_feedback(
        &self,
        task_id: &str,
        mut input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        input["threadId"] = Value::String(task_id.to_string());
        self.rpc("feedback/upload", Some(input)).await.map(|_| ())
    }
    async fn subscribe_events(
        &self,
        include_ephemeral: bool,
        _context: &PortRequestContext,
    ) -> Result<mpsc::Receiver<RawProviderEvent>, CodeAgentError> {
        let (sender, receiver) = mpsc::channel(EVENT_SUBSCRIBER_CAPACITY);
        self.subscribers
            .lock()
            .map_err(|_| CodeAgentError::internal("event subscriber registry is poisoned"))?
            .push(Subscriber {
                include_ephemeral,
                sender,
            });
        Ok(receiver)
    }
}
