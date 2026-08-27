use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState};
use crate::{
    domain::sidebar::{
        AgentTask, AgentTaskMutationResponse, AgentTaskPage, AgentTaskStatusResponse,
        ListTasksInput, ProjectDirectoryListing, ProjectMutationResponse, ProjectPage,
        RemoveProjectResponse,
    },
    infrastructure::{codex, filesystem::list_project_directories as read_project_directories},
};

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<ProjectPage, AppError> {
    let connection = state.codex_connection().await?;
    codex::list_projects(&connection)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_project(
    root_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::add_project(&connection, root_paths)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_project(
    project_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::rename_project(&connection, project_id, name)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn remove_project(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<RemoveProjectResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::remove_project(&connection, project_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_projects(
    project_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectPage, AppError> {
    let connection = state.codex_connection().await?;
    codex::reorder_projects(&connection, project_ids)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_project_directories(
    app: AppHandle,
    path: Option<String>,
    include_hidden: bool,
) -> Result<ProjectDirectoryListing, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::HomeDirectoryUnavailable)?;
    read_project_directories(&home, path.as_deref(), include_hidden)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command]
pub async fn list_tasks(
    input: ListTasksInput,
    state: State<'_, AppState>,
) -> Result<AgentTaskPage, AppError> {
    let connection = state.codex_connection().await?;
    codex::list_tasks(&connection, input)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTask, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id, task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_task(
    project_id: String,
    task_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::rename_task(&connection, project_id, task_id, title)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pin_task(
    project_id: String,
    task_id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::pin_task(&connection, project_id, task_id, pinned)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn archive_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::archive_task(&connection, project_id, task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn unarchive_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::unarchive_task(&connection, project_id, task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::delete_task(&connection, project_id, task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}
