use super::{error::AppError, prompt_submission::SubmissionBudget, turn_start::TurnStartRegistry};
use crate::domain::conversation::AgentPromptInput;
use serde_json::Value;
use std::{future::Future, sync::Arc};

pub(super) struct QueuedSteerRequest {
    pub project_id: String,
    pub task_id: String,
    pub turn_id: String,
    pub input: AgentPromptInput,
    pub idempotency_key: String,
    pub queued_submission_id: String,
}

pub(super) async fn run<E, F, C, D>(
    registry: Arc<TurnStartRegistry>,
    budget: &SubmissionBudget,
    request: QueuedSteerRequest,
    execute: E,
    cleanup: C,
) -> Result<Value, Value>
where
    E: FnOnce(AgentPromptInput) -> F + Send + 'static,
    F: Future<Output = Result<Value, AppError>> + Send + 'static,
    C: FnOnce() -> D + Send + 'static,
    D: Future<Output = Result<(), AppError>> + Send + 'static,
{
    let identity = super::turn_start::fingerprint_queued_steer(
        &request.project_id,
        &request.task_id,
        &request.turn_id,
        &request.queued_submission_id,
        &request.input,
    )?;
    let admission = budget.reserve(identity.encoded_bytes())?;
    // 协调任务持有入口预算；调用方取消等待不能中断已接受追加后的清理。
    tokio::spawn(async move {
        let _admission = admission;
        let result = registry.run(&request.idempotency_key, identity, execute(request.input)).await?;
        // 只缓存追加阶段，清理失败后同键重试只补做删除，不再次发送输入。
        cleanup().await.map_err(|_| serde_json::json!({
            "code": "QUEUE_CLEANUP_FAILED",
            "message": "Prompt was accepted, but queued item cleanup failed; retry this submission to finish cleanup"
        }))?;
        Ok(result)
    }).await.map_err(|_| serde_json::json!({
        "code": "TURN_START_UNCERTAIN",
        "message": "Queued steer result is unavailable; refresh the task before starting a new attempt"
    }))?
}

#[cfg(test)]
#[path = "queued_steer_tests.rs"]
mod tests;
