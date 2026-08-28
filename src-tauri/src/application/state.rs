use std::path::{Path, PathBuf};
use std::{collections::HashMap, sync::Arc};

use serde_json::{Value, json};
use tauri::ipc::Channel;
use tokio::{
    sync::{Mutex, mpsc},
    task::JoinHandle,
};

use super::error::AppError;
use super::model_turn_waiters::ModelTurnWaiters;
use super::turn_waiters::TurnStartedWaiters;
#[path = "state_event_forwarder.rs"]
mod event_forwarder;
use crate::{
    domain::runtime::{AppEvent, ProviderKind, RuntimeSnapshot, RuntimeStatus},
    infrastructure::codex::{AppServerConnection, CodexProcess, PendingServerRequest},
};
use event_forwarder::{required_event_string, spawn_event_forwarder};

const EVENT_QUEUE_CAPACITY: usize = 256;

#[derive(Default)]
pub struct AppState {
    runtime: Arc<Mutex<RuntimeSession>>,
}

#[derive(Default)]
struct RuntimeSession {
    event_sender: Option<mpsc::Sender<AppEvent>>,
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

        // 独立发布任务承担序列化和 WebView 调用，状态锁内只执行有界队列入队。
        runtime.set_event_channel(event_channel);
        runtime.snapshot
    }

    pub async fn start_codex(&self, app_data: &Path) -> Result<RuntimeSnapshot, AppError> {
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

        match CodexProcess::start(app_data).await {
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

    fn set_event_channel(&mut self, channel: Channel<AppEvent>) {
        let (sender, mut receiver) = mpsc::channel(EVENT_QUEUE_CAPACITY);
        tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                if channel.send(event).is_err() {
                    break;
                }
            }
        });
        self.event_sender = Some(sender);
    }

    fn publish(&self, event: AppEvent) -> Result<(), AppError> {
        self.event_sender
            .as_ref()
            .ok_or(AppError::RuntimeChannelUnavailable)?
            .try_send(event)
            .map_err(|_| AppError::RuntimeEventDeliveryFailed)
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
