use std::path::{Path, PathBuf};
use std::{collections::HashMap, future::Future, sync::Arc};

use serde_json::{Value, json};
use tauri::{AppHandle, ipc::Channel};
use tokio::{
    sync::{Mutex, mpsc},
    task::JoinHandle,
};

use super::error::AppError;
use super::model_turn_waiters::ModelTurnWaiters;
use super::request_cancellation::RequestCancellationRegistry;
use super::turn_waiters::TurnStartedWaiters;
#[path = "state_event_delivery.rs"]
mod event_delivery;
#[path = "state_event_delta_batcher.rs"]
mod event_delta_batcher;
#[path = "state_event_forwarder.rs"]
mod event_forwarder;
#[path = "state_start.rs"]
mod runtime_start;
use event_delivery::prepare_event_delivery;
#[path = "state_performance_metrics.rs"]
pub(super) mod performance_metrics;
#[path = "state_runtime_supervisor.rs"]
mod runtime_supervisor;
#[path = "state_task_activity.rs"]
mod task_activity_state;
#[path = "state_task_subscriptions.rs"]
mod task_subscriptions;
use super::task_activity::TaskActivityState;
use super::task_subscription::TaskSubscriptionLeases;
use crate::{
    domain::runtime::{
        AppEvent, CodexRuntimeAvailability, CodexRuntimeInstallProgress, ProviderKind,
        RuntimeSnapshot, RuntimeStatus,
    },
    infrastructure::{
        codex::{
            AppServerConnection, CodexProcess, PendingServerRequest, inspect_codex_runtime,
            install_codex_runtime,
        },
        workspace::ProjectFileSearch,
    },
};
use event_forwarder::{required_event_string, spawn_event_forwarder};
use performance_metrics::{RuntimePerformanceMetrics, RuntimePerformanceMetricsSnapshot};
use runtime_supervisor::{
    invalidate_runtime_restart, mark_runtime_started, prepare_runtime_restart,
    schedule_runtime_restart,
};

const EVENT_QUEUE_CAPACITY: usize = 256;

#[derive(Default)]
pub struct AppState {
    file_search: ProjectFileSearch,
    request_cancellations: RequestCancellationRegistry,
    runtime: Arc<Mutex<RuntimeSession>>,
    runtime_install: Mutex<()>,
    runtime_start: Mutex<()>,
}

#[derive(Default)]
struct RuntimeSession {
    event_sender: Option<mpsc::Sender<AppEvent>>,
    event_order: Arc<Mutex<()>>,
    snapshot: RuntimeSnapshot,
    codex_process: Option<CodexProcess>,
    _event_task: Option<JoinHandle<()>>,
    project_sequences: HashMap<String, u64>,
    task_projects: HashMap<String, String>,
    task_activity: TaskActivityState,
    task_subscription_leases: TaskSubscriptionLeases,
    pending_requests: HashMap<String, PendingServerRequest>,
    provider_login: Option<Value>,
    model_turn_waiters: ModelTurnWaiters,
    queue_editing_by_task: HashMap<String, String>,
    turn_started_waiters: TurnStartedWaiters,
    performance_metrics: RuntimePerformanceMetrics,
    runtime_started_at: Option<tokio::time::Instant>,
    restart_attempt: u32,
    restart_generation: u64,
}

impl AppState {
    pub fn project_file_search(&self) -> &ProjectFileSearch {
        &self.file_search
    }

    pub fn cancel_request(&self, request_id: &str) -> bool {
        self.request_cancellations.cancel(request_id)
    }

    pub async fn run_cancellable<T, F>(
        &self,
        request_id: Option<&str>,
        task: F,
    ) -> Result<T, AppError>
    where
        F: Future<Output = Result<T, AppError>>,
    {
        self.request_cancellations
            .run(request_id, task)
            .await
            .ok_or(AppError::RequestCancelled)?
    }

    pub async fn runtime_performance_metrics(&self) -> RuntimePerformanceMetricsSnapshot {
        self.runtime.lock().await.performance_metrics.snapshot()
    }

    pub async fn inspect_codex<OnProgress>(
        &self,
        app_data: &Path,
        on_progress: OnProgress,
    ) -> CodexRuntimeAvailability
    where
        OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
    {
        // 启动检测和手动重试共用安装锁；首次运行与版本变化都自动修复。
        let _install_guard = self.runtime_install.lock().await;
        match install_codex_runtime(app_data, on_progress).await {
            Ok(availability) => availability,
            Err(error) => {
                crate::infrastructure::diagnostics::record_error(
                    "codex_runtime_automatic_install_failed",
                    error,
                );
                inspect_codex_runtime(app_data).await
            }
        }
    }

    pub async fn install_codex<OnProgress>(
        &self,
        app_data: &Path,
        on_progress: OnProgress,
    ) -> Result<CodexRuntimeAvailability, AppError>
    where
        OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
    {
        // 串行化同一 Provider 的安装，避免双击触发重复下载和目录替换竞争。
        let _install_guard = self.runtime_install.lock().await;
        install_codex_runtime(app_data, on_progress)
            .await
            .map_err(|error| {
                crate::infrastructure::diagnostics::record_error(
                    "codex_runtime_install_failed",
                    error,
                );
                AppError::CodexRuntimeInstallFailed
            })
    }

    pub async fn connect(&self, event_channel: Channel<AppEvent>) -> RuntimeSnapshot {
        let mut runtime = self.runtime.lock().await;

        // 独立发布任务承担序列化和 WebView 调用，状态锁内只执行有界队列入队。
        runtime.set_event_channel(event_channel);
        runtime.snapshot
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
        let delivery = prepare_event_delivery(&self.runtime).await;
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
        drop(runtime);
        delivery
            .send(AppEvent::AgentEvent {
                event: event.into(),
            })
            .await;
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
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "state_reliability_tests.rs"]
mod reliability_tests;
