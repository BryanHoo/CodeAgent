use std::{str::FromStr, sync::Arc};

use code_agent_protocol::{GenerateCommitMessageRequest, GenerateCommitMessageResponse, ProjectId};
use code_agent_runtime::CodeAgentRuntime;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::command_error::CommandError;

#[derive(Debug, Deserialize)]
pub struct GitQuery {
    repository: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRequest {
    branch: String,
    expected_snapshot: String,
}

#[tauri::command]
pub async fn git_status(
    request_id: String,
    project_id: String,
    query: GitQuery,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .git_status(
            &request_id,
            &project(&project_id)?,
            query.repository.as_deref(),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn git_history(
    request_id: String,
    project_id: String,
    query: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .git_history(&request_id, &project(&project_id)?, &query)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn git_commit_files(
    request_id: String,
    project_id: String,
    query: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .git_commit_files(&request_id, &project(&project_id)?, &query)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn git_commit_diff(
    request_id: String,
    project_id: String,
    query: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .git_commit_diff(&request_id, &project(&project_id)?, &query)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn git_branch_switch(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    request: BranchRequest,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .git_switch_branch(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &request.branch,
            &request.expected_snapshot,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn git_branch_create(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    request: BranchRequest,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .git_create_branch(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &request.branch,
            &request.expected_snapshot,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn git_commit(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    request: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .git_commit(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &request,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn git_commit_message_generate(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    request: GenerateCommitMessageRequest,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<GenerateCommitMessageResponse, CommandError> {
    runtime
        .generate_commit_message(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &request,
        )
        .await
        .map_err(Into::into)
}

fn project(value: &str) -> Result<ProjectId, CommandError> {
    ProjectId::from_str(value).map_err(|_| CommandError::invalid_input("invalid project id"))
}
