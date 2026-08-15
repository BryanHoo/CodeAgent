use std::{str::FromStr, sync::Arc};

use code_agent_protocol::{AgentTaskPage, ProjectId};
use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;

use crate::command_error::CommandError;

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    task: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutationResponse {
    status: &'static str,
    task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUnsubscribeResponse {
    status: String,
    task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalMutationResponse {
    status: &'static str,
    terminal_id: String,
}

#[tauri::command]
pub async fn task_list(
    request_id: String,
    project_id: String,
    options: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<AgentTaskPage, CommandError> {
    runtime
        .list_agent_tasks(&request_id, &project(&project_id)?, options)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn task_start(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskResponse, CommandError> {
    let task = runtime
        .start_agent_task(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            json!({}),
        )
        .await?;
    Ok(TaskResponse { task })
}

#[tauri::command]
pub async fn task_read(
    request_id: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .read_agent_task(&request_id, &project(&project_id)?, &task_id)
        .await?
        .ok_or_else(|| not_found("task was not found"))
}

#[tauri::command]
pub async fn turn_list(
    request_id: String,
    project_id: String,
    task_id: String,
    cursor: Option<String>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .list_agent_task_turns(
            &request_id,
            &project(&project_id)?,
            &task_id,
            cursor.as_deref(),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn task_pin(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    pinned: bool,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskResponse, CommandError> {
    let task = runtime
        .pin_agent_task(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
            pinned,
        )
        .await?;
    Ok(TaskResponse { task })
}

#[tauri::command]
pub async fn task_rename(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    title: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskResponse, CommandError> {
    let project_id = project(&project_id)?;
    let snapshot = runtime
        .read_agent_task(&format!("{request_id}:read"), &project_id, &task_id)
        .await?
        .ok_or_else(|| not_found("task was not found"))?;
    let mut task = snapshot["snapshot"].clone();
    let title = title.trim();
    runtime
        .rename_agent_task(&request_id, &idempotency_key, &project_id, &task_id, title)
        .await?;
    task["title"] = Value::String(title.to_owned());
    Ok(TaskResponse { task })
}

#[tauri::command]
pub async fn task_archive(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskMutationResponse, CommandError> {
    runtime
        .archive_agent_task(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
        )
        .await?;
    Ok(TaskMutationResponse {
        status: "archived",
        task_id,
    })
}

#[tauri::command]
pub async fn task_unsubscribe(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskUnsubscribeResponse, CommandError> {
    let status = runtime
        .unsubscribe_agent_task(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
        )
        .await?;
    Ok(TaskUnsubscribeResponse { status, task_id })
}

#[tauri::command]
pub async fn task_fork(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskResponse, CommandError> {
    let task = runtime
        .fork_agent_task(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
        )
        .await?;
    Ok(TaskResponse { task })
}

#[tauri::command]
pub async fn task_compact(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskMutationResponse, CommandError> {
    runtime
        .compact_agent_task(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
        )
        .await?;
    Ok(TaskMutationResponse {
        status: "compacting",
        task_id,
    })
}

#[tauri::command]
pub async fn task_review(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    input: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    let turn = runtime
        .start_agent_review(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
            input["target"].clone(),
        )
        .await?;
    Ok(json!({ "taskId": task_id, "turn": turn }))
}

#[tauri::command]
pub async fn feedback_upload(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    input: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskMutationResponse, CommandError> {
    runtime
        .upload_agent_feedback(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
            input,
        )
        .await?;
    Ok(TaskMutationResponse {
        status: "sent",
        task_id,
    })
}

#[tauri::command]
pub async fn mcp_servers_list(
    request_id: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    serde_json::to_value(
        runtime
            .agent_mcp_servers(&request_id, &project(&project_id)?, &task_id)
            .await?,
    )
    .map_err(|error| internal(error.to_string()))
}

#[tauri::command]
pub async fn mcp_servers_retry(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    serde_json::to_value(
        runtime
            .reload_agent_mcp_servers(
                &request_id,
                &idempotency_key,
                &project(&project_id)?,
                &task_id,
            )
            .await?,
    )
    .map_err(|error| internal(error.to_string()))
}

#[tauri::command]
pub async fn terminals_list(
    request_id: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    serde_json::to_value(
        runtime
            .agent_background_terminals(&request_id, &project(&project_id)?, &task_id)
            .await?,
    )
    .map_err(|error| internal(error.to_string()))
}

#[tauri::command]
pub async fn terminal_terminate(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    terminal_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TerminalMutationResponse, CommandError> {
    runtime
        .terminate_agent_terminal(
            &request_id,
            &idempotency_key,
            &project(&project_id)?,
            &task_id,
            &terminal_id,
        )
        .await?;
    Ok(TerminalMutationResponse {
        status: "terminated",
        terminal_id,
    })
}

pub(crate) fn project(value: &str) -> Result<ProjectId, CommandError> {
    ProjectId::from_str(value).map_err(|_| invalid("invalid project id"))
}

fn invalid(message: &str) -> CommandError {
    CommandError::invalid_input(message)
}

fn not_found(message: &str) -> CommandError {
    CommandError::not_found(message)
}

fn internal(message: String) -> CommandError {
    CommandError::internal(message)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{TaskMutationResponse, project};

    #[test]
    fn validates_project_identity_and_serializes_public_response_shape() {
        assert!(project("project-1").is_ok());
        assert!(project("").is_err());
        let response = TaskMutationResponse {
            status: "archived",
            task_id: "task-1".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(response).expect("response"),
            json!({ "status": "archived", "taskId": "task-1" })
        );
    }
}
