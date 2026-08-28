use std::{collections::HashMap, path::PathBuf, sync::Arc};

use serde_json::{Value, json};
use tauri::ipc::Channel;
use tokio::{sync::Mutex, task::JoinHandle};

use super::error::AppError;
use super::model_turn_waiters::ModelTurnWaiters;
use super::turn_waiters::TurnStartedWaiters;
use crate::{
    domain::runtime::{AppEvent, ProviderKind, RuntimeSnapshot, RuntimeStatus},
    infrastructure::codex::{AppServerConnection, CodexProcess, PendingServerRequest},
};

#[derive(Default)]
pub struct AppState {
    runtime: Arc<Mutex<RuntimeSession>>,
}

#[derive(Default)]
struct RuntimeSession {
    event_channel: Option<Channel<AppEvent>>,
    snapshot: RuntimeSnapshot,
    codex_process: Option<CodexProcess>,
    _event_task: Option<JoinHandle<()>>,
    project_sequences: HashMap<String, u64>,
    task_projects: HashMap<String, String>,
    pending_requests: HashMap<String, PendingServerRequest>,
    provider_login: Option<Value>,
    mcp_statuses: HashMap<String, Value>,
    model_turn_waiters: ModelTurnWaiters,
    queue_editing_by_task: HashMap<String, String>,
    turn_started_waiters: TurnStartedWaiters,
}

impl AppState {
    pub async fn connect(&self, event_channel: Channel<AppEvent>) -> RuntimeSnapshot {
        let mut runtime = self.runtime.lock().await;

        // 保留唯一 Channel 所有权，后续运行时任务通过这里向 WebView 发布归一化事件。
        runtime.event_channel = Some(event_channel);
        runtime.snapshot
    }

    pub async fn start_codex(&self) -> Result<RuntimeSnapshot, AppError> {
        {
            let mut runtime = self.runtime.lock().await;
            if matches!(
                runtime.snapshot.status,
                RuntimeStatus::Starting | RuntimeStatus::Ready
            ) {
                return Ok(runtime.snapshot);
            }
            let event = runtime.transition(RuntimeStatus::Starting, Some(ProviderKind::Codex));
            runtime.publish(event)?;
        }

        match CodexProcess::start().await {
            Ok(process) => {
                let messages = process
                    .connection()
                    .take_server_messages()
                    .await
                    .map_err(|_| AppError::CodexRuntimeStartFailed)?;
                let event_task = spawn_event_forwarder(Arc::clone(&self.runtime), messages);
                let mut runtime = self.runtime.lock().await;
                runtime.codex_process = Some(process);
                runtime._event_task = Some(event_task);
                let event = runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
                runtime.publish(event)?;
                Ok(runtime.snapshot)
            }
            Err(error) => {
                let mut runtime = self.runtime.lock().await;
                eprintln!("codex runtime startup failed: {error}");
                let event = runtime.transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
                runtime.publish(event)?;
                Err(AppError::CodexRuntimeStartFailed)
            }
        }
    }

    pub async fn codex_connection(&self) -> Result<Arc<AppServerConnection>, AppError> {
        self.runtime
            .lock()
            .await
            .codex_process
            .as_ref()
            .map(CodexProcess::connection)
            .ok_or(AppError::CodexRuntimeUnavailable)
    }

    pub async fn codex_version(&self) -> Result<String, AppError> {
        self.runtime
            .lock()
            .await
            .codex_process
            .as_ref()
            .map(|process| process.version().to_owned())
            .ok_or(AppError::CodexRuntimeUnavailable)
    }

    pub async fn codex_home(&self) -> Result<PathBuf, AppError> {
        self.runtime
            .lock()
            .await
            .codex_process
            .as_ref()
            .map(|process| process.codex_home().to_owned())
            .ok_or(AppError::CodexRuntimeUnavailable)
    }

    pub async fn remember_tasks<'a>(
        &self,
        project_id: &str,
        task_ids: impl IntoIterator<Item = &'a str>,
    ) {
        let mut runtime = self.runtime.lock().await;
        runtime
            .project_sequences
            .entry(project_id.to_owned())
            .or_default();
        for task_id in task_ids {
            runtime
                .task_projects
                .insert(task_id.to_owned(), project_id.to_owned());
        }
    }

    pub async fn project_sequence(&self, project_id: &str) -> u64 {
        *self
            .runtime
            .lock()
            .await
            .project_sequences
            .get(project_id)
            .unwrap_or(&0)
    }

    pub async fn queue_editing_submission(&self, task_id: &str) -> Option<String> {
        self.runtime
            .lock()
            .await
            .queue_editing_by_task
            .get(task_id)
            .cloned()
    }

    pub async fn update_queue_editing(&self, task_id: &str, submission_id: &str, editing: bool) {
        let mut runtime = self.runtime.lock().await;
        if editing {
            runtime
                .queue_editing_by_task
                .insert(task_id.to_owned(), submission_id.to_owned());
        } else if runtime
            .queue_editing_by_task
            .get(task_id)
            .is_some_and(|current| current == submission_id)
        {
            runtime.queue_editing_by_task.remove(task_id);
        }
    }

    pub async fn clear_queue_editing(&self, task_id: &str) {
        self.runtime
            .lock()
            .await
            .queue_editing_by_task
            .remove(task_id);
    }

    pub async fn register_turn_started(
        &self,
        task_id: &str,
    ) -> (u64, tokio::sync::oneshot::Receiver<Value>) {
        self.runtime
            .lock()
            .await
            .turn_started_waiters
            .register(task_id)
    }

    pub async fn cancel_turn_started(&self, task_id: &str, waiter_id: u64) {
        self.runtime
            .lock()
            .await
            .turn_started_waiters
            .cancel(task_id, waiter_id);
    }

    pub async fn register_model_turn(
        &self,
        thread_id: &str,
    ) -> tokio::sync::oneshot::Receiver<Option<String>> {
        self.runtime
            .lock()
            .await
            .model_turn_waiters
            .register(thread_id)
    }

    pub async fn cancel_model_turn(&self, thread_id: &str) {
        self.runtime
            .lock()
            .await
            .model_turn_waiters
            .cancel(thread_id);
    }

    pub async fn take_pending_request(&self, request_id: &str) -> Option<PendingServerRequest> {
        self.runtime
            .lock()
            .await
            .pending_requests
            .remove(request_id)
    }

    pub async fn restore_pending_request(&self, pending: PendingServerRequest) {
        let Some(request_id) = pending
            .request
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return;
        };
        self.runtime
            .lock()
            .await
            .pending_requests
            .insert(request_id, pending);
    }

    pub async fn provider_login(&self) -> Option<Value> {
        self.runtime.lock().await.provider_login.clone()
    }

    pub async fn set_provider_login(&self, pending: Option<Value>) {
        self.runtime.lock().await.provider_login = pending;
    }

    pub async fn mcp_statuses(&self, task_id: &str) -> Vec<Value> {
        self.runtime
            .lock()
            .await
            .mcp_statuses
            .iter()
            .filter(|(key, _)| key.starts_with(&format!("{task_id}\0")) || key.starts_with("*\0"))
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub async fn publish_resolved_request(
        &self,
        pending: &PendingServerRequest,
    ) -> Result<Value, AppError> {
        let mut request = pending.request.clone();
        request["status"] = json!("resolved");
        let project_id = required_event_string(&request, "projectId")?;
        let item_id = required_event_string(&request, "itemId")?;
        let task_id = required_event_string(&request, "taskId")?;
        let turn_id = required_event_string(&request, "turnId")?;
        let timestamp = required_event_string(&request, "createdAt")?;
        let mut runtime = self.runtime.lock().await;
        let sequence = runtime.project_sequences.entry(project_id).or_default();
        *sequence += 1;
        let event = json!({
            "itemId": item_id,
            "payload": {"request": request.clone()},
            "provider": "codex",
            "sequence": *sequence,
            "sessionId": crate::infrastructure::codex::RUNTIME_SESSION_ID,
            "taskId": task_id,
            "timestamp": timestamp,
            "turnId": turn_id,
            "type": "pending_request.resolved",
            "version": 2,
        });
        runtime.publish(AppEvent::AgentEvent { event })?;
        Ok(request)
    }
}

fn spawn_event_forwarder(
    runtime: Arc<Mutex<RuntimeSession>>,
    mut messages: tokio::sync::mpsc::Receiver<crate::infrastructure::codex::ServerMessage>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(message) = messages.recv().await {
            let mut runtime = runtime.lock().await;
            if matches!(message.method.as_str(), "item/completed" | "turn/completed")
                && let Ok(params) = serde_json::from_str::<Value>(message.params.get())
            {
                // 内部临时 Turn 不进入任务列表，只在这里提取最终模型输出。
                runtime.model_turn_waiters.observe(&message.method, &params);
            }
            if message.id.is_none() && message.method == "account/login/completed" {
                // 登录通知只更新短期状态，Token 和 API key 始终由 Codex 自己持有。
                let params = serde_json::from_str::<Value>(message.params.get());
                if let Ok(params) = params {
                    if params.get("success").and_then(Value::as_bool) == Some(true) {
                        runtime.provider_login = None;
                    } else {
                        let login_id = params
                            .get("loginId")
                            .and_then(Value::as_str)
                            .or_else(|| {
                                runtime
                                    .provider_login
                                    .as_ref()
                                    .and_then(|value| value.get("loginId"))
                                    .and_then(Value::as_str)
                            })
                            .unwrap_or("unknown")
                            .to_owned();
                        runtime.provider_login = Some(json!({
                            "error": params.get("error").and_then(Value::as_str).unwrap_or("Login failed"),
                            "loginId": login_id,
                            "state": "failed"
                        }));
                    }
                }
                continue;
            }
            if message.id.is_none() && message.method == "mcpServer/startupStatus/updated" {
                let mut task_scoped = false;
                if let Ok(params) = serde_json::from_str::<Value>(message.params.get())
                    && let Some(name) = params.get("name").and_then(Value::as_str)
                {
                    let thread = params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .unwrap_or("*");
                    task_scoped = thread != "*";
                    runtime
                        .mcp_statuses
                        .insert(format!("{thread}\0{name}"), params);
                }
                // 任务级通知继续进入统一事件流，驱动前端重新读取完整 MCP 清单。
                if !task_scoped {
                    continue;
                }
            }
            if message.method == "serverRequest/resolved" {
                let request_id = match crate::infrastructure::codex::resolved_request_id(&message) {
                    Ok(Some(request_id)) => request_id,
                    Ok(None) => continue,
                    Err(error) => {
                        eprintln!("failed to map resolved codex request: {error}");
                        continue;
                    }
                };
                let Some(pending) = runtime.pending_requests.remove(&request_id) else {
                    continue;
                };
                if publish_terminal_request(&mut runtime, pending, "expired").is_err() {
                    break;
                }
                continue;
            }
            let (mut event, mut pending) = if message.id.is_some() {
                match crate::infrastructure::codex::map_server_request_now(message, 0) {
                    Ok(Some(mapped)) => {
                        let mapped: crate::infrastructure::codex::MappedServerRequest = mapped;
                        (mapped.event, Some(mapped.pending))
                    }
                    Ok(None) => continue,
                    Err(error) => {
                        eprintln!("failed to map codex request: {error}");
                        continue;
                    }
                }
            } else {
                match crate::infrastructure::codex::map_server_message_now(message, 0) {
                    Ok(Some(event)) => (event, None),
                    Ok(None) => continue,
                    Err(error) => {
                        eprintln!("failed to map codex event: {error}");
                        continue;
                    }
                }
            };
            let Some(task_id) = event
                .get("taskId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
            else {
                continue;
            };
            let Some(project_id) = runtime.task_projects.get(&task_id).cloned() else {
                continue;
            };
            if let Some(pending) = pending.as_mut() {
                pending.request["projectId"] = json!(project_id);
                event["payload"]["request"]["projectId"] = json!(project_id);
            }
            let sequence = runtime
                .project_sequences
                .entry(project_id.clone())
                .or_default();
            *sequence += 1;
            event["sequence"] = serde_json::Value::from(*sequence);
            if event.get("type").and_then(Value::as_str) == Some("turn.started")
                && let Some(turn) = event.pointer("/payload/turn")
            {
                let turn = turn.clone();
                runtime.turn_started_waiters.resolve(&task_id, &turn);
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
                runtime.pending_requests.insert(request_id, pending);
            }
            if runtime.publish(AppEvent::AgentEvent { event }).is_err() {
                break;
            }
        }

        let mut runtime = runtime.lock().await;
        runtime.codex_process = None;
        runtime._event_task = None;
        runtime.turn_started_waiters.clear();
        runtime.model_turn_waiters.clear();
        let pending = std::mem::take(&mut runtime.pending_requests);
        for (_, request) in pending {
            let _ = publish_terminal_request(&mut runtime, request, "expired");
        }
        let event = runtime.transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
        let _ = runtime.publish(event);
    })
}

fn publish_terminal_request(
    runtime: &mut RuntimeSession,
    pending: PendingServerRequest,
    status: &str,
) -> Result<(), AppError> {
    let mut request = pending.request;
    request["status"] = json!(status);
    let project_id = required_event_string(&request, "projectId")?;
    let item_id = required_event_string(&request, "itemId")?;
    let task_id = required_event_string(&request, "taskId")?;
    let timestamp = required_event_string(&request, "createdAt")?;
    let turn_id = required_event_string(&request, "turnId")?;
    let sequence = runtime.project_sequences.entry(project_id).or_default();
    *sequence += 1;
    let event = json!({
        "itemId": item_id,
        "payload": {"request": request},
        "provider": "codex",
        "sequence": *sequence,
        "sessionId": crate::infrastructure::codex::RUNTIME_SESSION_ID,
        "taskId": task_id,
        "timestamp": timestamp,
        "turnId": turn_id,
        "type": "pending_request.expired",
        "version": 2,
    });
    runtime.publish(AppEvent::AgentEvent { event })
}

fn required_event_string(value: &Value, key: &str) -> Result<String, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(AppError::CodexRequestFailed)
}

impl RuntimeSession {
    fn transition(&mut self, status: RuntimeStatus, provider: Option<ProviderKind>) -> AppEvent {
        self.snapshot.last_seq += 1;
        self.snapshot.status = status;
        self.snapshot.provider = provider;
        AppEvent::RuntimeStatus {
            seq: self.snapshot.last_seq,
            status,
            provider,
        }
    }

    fn publish(&self, event: AppEvent) -> Result<(), AppError> {
        self.event_channel
            .as_ref()
            .ok_or(AppError::RuntimeChannelUnavailable)?
            .send(event)
            .map_err(|_| AppError::RuntimeEventDeliveryFailed)
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
