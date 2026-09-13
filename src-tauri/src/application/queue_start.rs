use super::{
    error::AppError,
    prompt_submission::SubmissionBudget,
    state::AppState,
    turn_start::{TurnStartRegistry, fingerprint_queue_start},
};
use serde_json::Value;
use std::future::Future;
use tauri::{AppHandle, Manager};

#[tauri::command(rename_all = "camelCase")]
pub async fn start_queued_submission(
    app: AppHandle,
    project_id: String,
    task_id: String,
    queued_submission_id: Option<String>,
    idempotency_key: String,
) -> Result<Value, Value> {
    let state = app.state::<AppState>();
    let worker_app = app.clone();
    let worker_project = project_id.clone();
    let worker_task = task_id.clone();
    let worker_submission = queued_submission_id.clone();
    run(
        &state.queue_starts,
        &state.submission_budget,
        QueueStartRequest {
            project_id,
            task_id,
            queued_submission_id,
            idempotency_key,
        },
        async move {
            let state = worker_app.state::<AppState>();
            let connection = state.codex_connection().await?;
            crate::infrastructure::codex::read_task(
                &connection,
                worker_project,
                worker_task.clone(),
            )
            .await
            .map_err(AppError::from)?;
            let response = crate::infrastructure::codex::start_queued_submission(
                &connection,
                &worker_task,
                worker_submission.as_deref(),
            )
            .await
            .map_err(AppError::from)?;
            // 仅首次确认启动后清除编辑状态；重放不能修改后来建立的编辑状态。
            state.clear_queue_editing(&worker_task).await;
            serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
        },
    )
    .await
}

struct QueueStartRequest {
    project_id: String,
    task_id: String,
    queued_submission_id: Option<String>,
    idempotency_key: String,
}

async fn run<F>(
    registry: &TurnStartRegistry,
    budget: &SubmissionBudget,
    request: QueueStartRequest,
    execute: F,
) -> Result<Value, Value>
where
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
{
    let identity = fingerprint_queue_start(
        &request.project_id,
        &request.task_id,
        request.queued_submission_id.as_deref(),
    )?;
    let _admission = budget.reserve(identity.encoded_bytes())?;
    // 未指定队列项也是固定请求身份，重放只能返回原 Turn，不能重新消费下一项。
    registry
        .run(&request.idempotency_key, identity, execute)
        .await
}

#[cfg(test)]
#[path = "queue_start_tests.rs"]
mod tests;
