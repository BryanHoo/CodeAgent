use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState};
use crate::{domain::conversation::AgentPromptInput, infrastructure::codex};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFeedbackInput {
    classification: String,
    include_logs: bool,
    reason: String,
}

async fn validate_task(
    state: &State<'_, AppState>,
    project_id: String,
    task_id: &str,
) -> Result<std::sync::Arc<codex::AppServerConnection>, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id, task_id.to_owned())
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    Ok(connection)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_task_goal(
    project_id: String,
    task_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::update_goal(&connection, &task_id, &status)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn clear_task_goal(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::clear_goal(&connection, &task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn upload_feedback(
    project_id: String,
    task_id: String,
    input: UploadFeedbackInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::upload_feedback(
        &connection,
        &task_id,
        &input.classification,
        &input.reason,
        input.include_logs,
    )
    .await
    .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_background_terminals(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::list_background_terminals(&connection, &task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn terminate_background_terminal(
    project_id: String,
    task_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::terminate_background_terminal(&connection, &task_id, &terminal_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_queued_submissions(
    project_id: String,
    task_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let mut response =
        codex::list_queued_submissions(&connection, &task_id, cursor.as_deref(), limit)
            .await
            .map_err(|_| AppError::CodexRequestFailed)?;
    if let Some(editing_id) = state.queue_editing_submission(&task_id).await {
        if let Some(submission) = response.data.iter_mut().find(|item| item.id == editing_id) {
            submission.status = "editing";
        } else {
            state.clear_queue_editing(&task_id).await;
        }
    }
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_queued_submission(
    app: AppHandle,
    project_id: String,
    task_id: String,
    mut input: AgentPromptInput,
    client_user_message_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    super::attachment_commands::resolve_prompt_attachments(&app_data, &project_id, &mut input)
        .await?;
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response =
        codex::add_queued_submission(&connection, &task_id, &input, &client_user_message_id)
            .await
            .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_queued_submission(
    app: AppHandle,
    project_id: String,
    task_id: String,
    queued_submission_id: String,
    mut input: AgentPromptInput,
    status: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let editing = match status.as_str() {
        "editing" => true,
        "queued" => false,
        _ => return Err(AppError::CodexRequestFailed),
    };
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    super::attachment_commands::resolve_prompt_attachments(&app_data, &project_id, &mut input)
        .await?;
    let connection = validate_task(&state, project_id, &task_id).await?;
    let mut response =
        codex::update_queued_submission(&connection, &task_id, &queued_submission_id, &input)
            .await
            .map_err(|_| AppError::CodexRequestFailed)?;
    response.queued_submission.status = if editing { "editing" } else { "queued" };
    state
        .update_queue_editing(&task_id, &queued_submission_id, editing)
        .await;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_queued_submission(
    project_id: String,
    task_id: String,
    queued_submission_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::delete_queued_submission(&connection, &task_id, &queued_submission_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    state
        .update_queue_editing(&task_id, &queued_submission_id, false)
        .await;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_queued_submissions(
    project_id: String,
    task_id: String,
    queued_submission_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response = codex::reorder_queued_submissions(&connection, &task_id, &queued_submission_ids)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_queued_submission(
    project_id: String,
    task_id: String,
    queued_submission_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = validate_task(&state, project_id, &task_id).await?;
    let response =
        codex::start_queued_submission(&connection, &task_id, queued_submission_id.as_deref())
            .await
            .map_err(|_| AppError::CodexRequestFailed)?;
    state.clear_queue_editing(&task_id).await;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}
