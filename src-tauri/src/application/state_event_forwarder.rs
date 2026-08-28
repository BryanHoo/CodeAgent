use std::sync::Arc;

use serde_json::{Value, json};
use tokio::{
    sync::{Mutex, mpsc},
    task::JoinHandle,
};

use super::{super::error::AppError, RuntimeSession};
use crate::{
    domain::runtime::{AppEvent, ProviderKind, RuntimeStatus},
    infrastructure::codex::{MappedServerRequest, PendingServerRequest, ServerMessage},
};

pub(super) fn spawn_event_forwarder(
    runtime: Arc<Mutex<RuntimeSession>>,
    mut messages: mpsc::Receiver<ServerMessage>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(message) = messages.recv().await {
            // JSON 建树和协议映射可能随 delta 体积增长，必须在全局状态锁之外完成。
            observe_model_turn(&runtime, &message).await;
            if handle_login_notification(&runtime, &message).await {
                continue;
            }
            if handle_mcp_status(&runtime, &message).await == McpStatusAction::CachedOnly {
                continue;
            }
            if message.method == "serverRequest/resolved" {
                if !handle_resolved_request(&runtime, &message).await {
                    break;
                }
                continue;
            }

            let Some((mut event, mut pending)) = map_message(message) else {
                continue;
            };
            let Some(task_id) = event
                .get("taskId")
                .and_then(Value::as_str)
                .map(str::to_owned)
            else {
                continue;
            };

            // 锁内仅维护共享索引、序号和 waiter；publish 只写入有界发布队列。
            let mut session = runtime.lock().await;
            let Some(project_id) = session.task_projects.get(&task_id).cloned() else {
                continue;
            };
            if let Some(pending) = pending.as_mut() {
                pending.request["projectId"] = json!(project_id);
                event["payload"]["request"]["projectId"] = json!(project_id);
            }
            let sequence = session.project_sequences.entry(project_id).or_default();
            *sequence += 1;
            event["sequence"] = Value::from(*sequence);
            if event.get("type").and_then(Value::as_str) == Some("turn.started")
                && let Some(turn) = event.pointer("/payload/turn")
            {
                session.turn_started_waiters.resolve(&task_id, turn);
            }
            if let Some(pending) = pending {
                let Some(request_id) = pending
                    .request
                    .get("requestId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                else {
                    continue;
                };
                session.pending_requests.insert(request_id, pending);
            }
            if session.publish(AppEvent::AgentEvent { event }).is_err() {
                break;
            }
        }

        finish_runtime(&runtime).await;
    })
}

async fn observe_model_turn(runtime: &Arc<Mutex<RuntimeSession>>, message: &ServerMessage) {
    if matches!(message.method.as_str(), "item/completed" | "turn/completed")
        && let Ok(params) = serde_json::from_str::<Value>(message.params.get())
    {
        // 内部临时 Turn 不进入任务列表，只提取最终模型输出。
        runtime
            .lock()
            .await
            .model_turn_waiters
            .observe(&message.method, &params);
    }
}

async fn handle_login_notification(
    runtime: &Arc<Mutex<RuntimeSession>>,
    message: &ServerMessage,
) -> bool {
    if message.id.is_some() || message.method != "account/login/completed" {
        return false;
    }
    let Ok(params) = serde_json::from_str::<Value>(message.params.get()) else {
        return true;
    };
    let mut session = runtime.lock().await;
    if params.get("success").and_then(Value::as_bool) == Some(true) {
        session.provider_login = None;
    } else {
        let login_id = params
            .get("loginId")
            .and_then(Value::as_str)
            .or_else(|| {
                session
                    .provider_login
                    .as_ref()
                    .and_then(|value| value.get("loginId"))
                    .and_then(Value::as_str)
            })
            .unwrap_or("unknown");
        session.provider_login = Some(json!({
            "error": params.get("error").and_then(Value::as_str).unwrap_or("Login failed"),
            "loginId": login_id,
            "state": "failed"
        }));
    }
    true
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum McpStatusAction {
    NotApplicable,
    CachedOnly,
    CachedAndForward,
}

async fn handle_mcp_status(
    runtime: &Arc<Mutex<RuntimeSession>>,
    message: &ServerMessage,
) -> McpStatusAction {
    if message.id.is_some() || message.method != "mcpServer/startupStatus/updated" {
        return McpStatusAction::NotApplicable;
    }
    let Ok(params) = serde_json::from_str::<Value>(message.params.get()) else {
        return McpStatusAction::CachedOnly;
    };
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return McpStatusAction::CachedOnly;
    };
    let thread = params
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("*");
    let action = if thread == "*" {
        McpStatusAction::CachedOnly
    } else {
        McpStatusAction::CachedAndForward
    };
    runtime
        .lock()
        .await
        .mcp_statuses
        .insert(format!("{thread}\0{name}"), params);
    action
}

async fn handle_resolved_request(
    runtime: &Arc<Mutex<RuntimeSession>>,
    message: &ServerMessage,
) -> bool {
    let request_id = match crate::infrastructure::codex::resolved_request_id(message) {
        Ok(Some(request_id)) => request_id,
        Ok(None) => return true,
        Err(error) => {
            eprintln!("failed to map resolved codex request: {error}");
            return true;
        }
    };
    let pending = runtime.lock().await.pending_requests.remove(&request_id);
    let Some(pending) = pending else {
        return true;
    };
    let Ok((project_id, event)) = map_terminal_request(pending, "expired") else {
        return false;
    };
    let mut session = runtime.lock().await;
    publish_terminal_event(&mut session, project_id, event).is_ok()
}

fn map_message(message: ServerMessage) -> Option<(Value, Option<PendingServerRequest>)> {
    if message.id.is_some() {
        match crate::infrastructure::codex::map_server_request_now(message, 0) {
            Ok(Some(mapped)) => {
                let mapped: MappedServerRequest = mapped;
                Some((mapped.event, Some(mapped.pending)))
            }
            Ok(None) => None,
            Err(error) => {
                eprintln!("failed to map codex request: {error}");
                None
            }
        }
    } else {
        match crate::infrastructure::codex::map_server_message_now(message, 0) {
            Ok(Some(event)) => Some((event, None)),
            Ok(None) => None,
            Err(error) => {
                eprintln!("failed to map codex event: {error}");
                None
            }
        }
    }
}

async fn finish_runtime(runtime: &Arc<Mutex<RuntimeSession>>) {
    let pending = {
        let mut session = runtime.lock().await;
        session.codex_process = None;
        session._event_task = None;
        session.turn_started_waiters.clear();
        session.model_turn_waiters.clear();
        std::mem::take(&mut session.pending_requests)
    };
    let terminal_events = pending
        .into_values()
        .filter_map(|request| map_terminal_request(request, "expired").ok())
        .collect::<Vec<_>>();
    let mut session = runtime.lock().await;
    for (project_id, event) in terminal_events {
        let _ = publish_terminal_event(&mut session, project_id, event);
    }
    let event = session.transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
    let _ = session.publish(event);
}

fn map_terminal_request(
    pending: PendingServerRequest,
    status: &str,
) -> Result<(String, Value), AppError> {
    let mut request = pending.request;
    request["status"] = json!(status);
    let project_id = required_event_string(&request, "projectId")?;
    let event = json!({
        "itemId": required_event_string(&request, "itemId")?,
        "payload": {"request": request},
        "provider": "codex",
        "sequence": 0,
        "sessionId": crate::infrastructure::codex::RUNTIME_SESSION_ID,
        "taskId": required_event_string(&request, "taskId")?,
        "timestamp": required_event_string(&request, "createdAt")?,
        "turnId": required_event_string(&request, "turnId")?,
        "type": "pending_request.expired",
        "version": 2,
    });
    Ok((project_id, event))
}

fn publish_terminal_event(
    runtime: &mut RuntimeSession,
    project_id: String,
    mut event: Value,
) -> Result<(), AppError> {
    let sequence = runtime.project_sequences.entry(project_id).or_default();
    *sequence += 1;
    event["sequence"] = Value::from(*sequence);
    runtime.publish(AppEvent::AgentEvent { event })
}

pub(super) fn required_event_string(value: &Value, key: &str) -> Result<String, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(AppError::CodexRequestFailed)
}
