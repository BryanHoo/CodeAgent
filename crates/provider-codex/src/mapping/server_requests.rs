use chrono::{DateTime, Duration, SecondsFormat, Utc};
use code_agent_protocol::{ValueDefinition, parse_protocol_value};
use serde_json::{Value, json};

use crate::RpcServerRequest;

use super::common::{CodexMappingError, boolean, field_string, record};
use super::turns::optional_nullable_string;

#[derive(Clone, Debug, PartialEq)]
pub struct PendingCodexRequest {
    pub deny_decision: Option<&'static str>,
    pub provider_request_id: Value,
    pub request: Value,
}

pub(crate) fn request_id_key(value: &Value) -> Result<String, CodexMappingError> {
    match value {
        Value::Number(number) => Ok(format!("number:{number}")),
        Value::String(value) => Ok(format!("string:{value}")),
        _ => Err(CodexMappingError(
            "Codex request id must be a string or number".to_string(),
        )),
    }
}

fn approval_decisions(
    value: Option<&Value>,
) -> Result<(Vec<&'static str>, &'static str), CodexMappingError> {
    let defaults = vec!["accept", "acceptForSession", "decline"];
    let native = match value {
        Some(Value::Array(values)) => values.iter().filter_map(Value::as_str).collect::<Vec<_>>(),
        None => defaults,
        Some(_) => Vec::new(),
    };
    let mut decisions = Vec::new();
    if native.contains(&"accept") {
        decisions.push("allow");
    }
    if native.contains(&"acceptForSession") {
        decisions.push("allow_for_session");
    }
    if native.contains(&"decline") || native.contains(&"cancel") {
        decisions.push("deny");
    }
    if decisions.is_empty() {
        return Err(CodexMappingError(
            "Codex approval has no supported decisions".to_string(),
        ));
    }
    Ok((
        decisions,
        if native.contains(&"decline") {
            "decline"
        } else {
            "cancel"
        },
    ))
}

fn timestamp_millis(value: &Value, context: &str) -> Result<String, CodexMappingError> {
    let millis = value.as_i64().ok_or_else(|| {
        CodexMappingError(format!(
            "{context} must be a Unix timestamp in milliseconds"
        ))
    })?;
    DateTime::from_timestamp_millis(millis)
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| CodexMappingError(format!("{context} is out of range")))
}

fn map_network_access(value: Option<&Value>) -> Result<Value, CodexMappingError> {
    let Some(value) = value else {
        return Ok(Value::Null);
    };
    if value.is_null() {
        return Ok(Value::Null);
    }
    let context = record(value, "Codex network approval context")?;
    let host = field_string(context, "host", "Codex network approval context")?;
    let protocol = field_string(context, "protocol", "Codex network approval context")?;
    if host.is_empty() || !matches!(protocol, "http" | "https" | "socks5Tcp" | "socks5Udp") {
        return Err(CodexMappingError(
            "Codex network approval context is invalid".to_string(),
        ));
    }
    Ok(json!({ "host": host, "protocol": protocol }))
}

fn confirmation_options(options: &[Value]) -> bool {
    if options.len() != 2 {
        return false;
    }
    let labels = options
        .iter()
        .filter_map(|option| option["label"].as_str())
        .map(|label| label.trim().to_lowercase())
        .collect::<Vec<_>>();
    [
        ["yes", "no"],
        ["是", "否"],
        ["确认", "取消"],
        ["allow", "deny"],
        ["accept", "decline"],
    ]
    .iter()
    .any(|pair| {
        pair.iter()
            .all(|label| labels.iter().any(|candidate| candidate == label))
    })
}

fn user_input_questions(value: &Value) -> Result<Vec<Value>, CodexMappingError> {
    let questions = value
        .as_array()
        .filter(|questions| (1..=3).contains(&questions.len()))
        .ok_or_else(|| {
            CodexMappingError("Codex user input questions must contain 1 to 3 items".to_string())
        })?;
    questions
        .iter()
        .map(|question| {
            let question = record(question, "Codex user input question")?;
            let is_other = match question.get("isOther") {
                None => false,
                Some(value) => boolean(value, "Codex user input isOther")?,
            };
            let is_secret = match question.get("isSecret") {
                None => false,
                Some(value) => boolean(value, "Codex user input isSecret")?,
            };
            let native_options = question.get("options").unwrap_or(&Value::Null);
            let options = match native_options {
                Value::Null => Vec::new(),
                Value::Array(values) => values
                    .iter()
                    .map(|option| {
                        let option = record(option, "Codex user input option")?;
                        Ok(json!({
                            "description": field_string(option, "description", "Codex user input option")?,
                            "label": field_string(option, "label", "Codex user input option")?
                        }))
                    })
                    .collect::<Result<Vec<_>, CodexMappingError>>()?,
                _ => return Err(CodexMappingError("Codex user input options must be an array or null".to_string())),
            };
            if !native_options.is_null() && options.is_empty() && !is_other {
                return Err(CodexMappingError("Codex choice question has no available answer".to_string()));
            }
            let question_type = if native_options.is_null() {
                "short_text"
            } else if confirmation_options(&options) && !is_other {
                "confirmation"
            } else {
                "choice"
            };
            Ok(json!({
                "header": field_string(question, "header", "Codex user input question")?,
                "id": field_string(question, "id", "Codex user input question")?,
                "isOther": is_other,
                "isSecret": is_secret,
                "options": options,
                "prompt": field_string(question, "question", "Codex user input question")?,
                "type": question_type
            }))
        })
        .collect()
}

/// 映射 Codex 双向请求，并以调用方提供的时钟生成可测试的 Pending 生命周期。
pub fn map_codex_server_request(
    server_request: &RpcServerRequest,
    project_id: &str,
    now: DateTime<Utc>,
) -> Result<Option<PendingCodexRequest>, CodexMappingError> {
    if !matches!(
        server_request.method.as_str(),
        "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/tool/requestUserInput"
    ) {
        return Ok(None);
    }
    let params = record(&server_request.params, "Codex server request params")?;
    let task_id = field_string(params, "threadId", "Codex server request")?;
    let turn_id = field_string(params, "turnId", "Codex server request")?;
    let item_id = field_string(params, "itemId", "Codex server request")?;
    let request_id = request_id_key(&server_request.id)?;

    let (request, deny_decision) = if server_request.method == "item/tool/requestUserInput" {
        boolean(
            params.get("isBlocking").unwrap_or(&Value::Null),
            "Codex user input isBlocking",
        )?;
        let expires_at = match params.get("autoResolutionMs").unwrap_or(&Value::Null) {
            Value::Null => Value::Null,
            value => {
                let millis = value.as_i64().filter(|value| *value >= 0).ok_or_else(|| {
                    CodexMappingError("Codex user input autoResolutionMs is invalid".to_string())
                })?;
                Value::String(
                    (now + Duration::milliseconds(millis))
                        .to_rfc3339_opts(SecondsFormat::Millis, true),
                )
            }
        };
        (
            json!({
                "createdAt": now.to_rfc3339_opts(SecondsFormat::Millis, true),
                "expiresAt": expires_at,
                "itemId": item_id,
                "projectId": project_id,
                "questions": user_input_questions(params.get("questions").unwrap_or(&Value::Null))?,
                "requestId": request_id,
                "status": "pending",
                "taskId": task_id,
                "turnId": turn_id,
                "type": "user_input"
            }),
            None,
        )
    } else {
        let (available_decisions, deny_decision) =
            approval_decisions(params.get("availableDecisions"))?;
        let created_at = timestamp_millis(
            params.get("startedAtMs").unwrap_or(&Value::Null),
            "Codex approval startedAtMs",
        )?;
        let identity = json!({
            "availableDecisions": available_decisions,
            "createdAt": created_at,
            "expiresAt": null,
            "itemId": item_id,
            "projectId": project_id,
            "requestId": request_id,
            "status": "pending",
            "taskId": task_id,
            "turnId": turn_id
        });
        let mut request = identity;
        if server_request.method == "item/commandExecution/requestApproval" {
            request["command"] =
                optional_nullable_string(params.get("command"), "Codex approval command")?;
            request["cwd"] = optional_nullable_string(params.get("cwd"), "Codex approval cwd")?;
            request["networkAccess"] = map_network_access(params.get("networkApprovalContext"))?;
            request["reason"] =
                optional_nullable_string(params.get("reason"), "Codex approval reason")?;
            request["type"] = Value::String("command_approval".to_string());
        } else {
            request["grantRoot"] =
                optional_nullable_string(params.get("grantRoot"), "Codex approval grantRoot")?;
            request["reason"] =
                optional_nullable_string(params.get("reason"), "Codex approval reason")?;
            request["type"] = Value::String("file_change_approval".to_string());
        }
        (request, Some(deny_decision))
    };

    let request = parse_protocol_value(ValueDefinition::PendingRequest, request)?;
    Ok(Some(PendingCodexRequest {
        deny_decision,
        provider_request_id: server_request.id.clone(),
        request,
    }))
}
