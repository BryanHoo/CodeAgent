use std::path::Path;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, workspace_commands::project_root};
use crate::infrastructure::{codex, workspace};

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_open_capabilities(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_project(&connection, &project_id)
        .await
        .map_err(AppError::from)?;
    let (platform, apps) = workspace::platform_apps();
    Ok(json!({"apps": apps, "platform": platform}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_project(
    project_id: String,
    root_path: Option<String>,
    app_id: String,
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let root = match root_path {
        Some(root_path) => project_root(&state, &project_id, &root_path).await?.1,
        None => {
            let connection = state.codex_connection().await?;
            let project = codex::read_project(&connection, &project_id)
                .await
                .map_err(AppError::from)?;
            let root = project
                .roots
                .first()
                .ok_or(AppError::FilesystemRequestFailed)?;
            workspace::canonical_root(&root.path)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?
        }
    };
    let target = match path {
        Some(path) => {
            let candidate = if Path::new(&path).is_absolute() {
                path
            } else {
                root.join(path).to_string_lossy().into_owned()
            };
            let resolved = tokio::fs::canonicalize(candidate)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            if !resolved.starts_with(&root) {
                return Err(AppError::FilesystemRequestFailed);
            }
            resolved
        }
        None => root,
    };
    workspace::open_path(&app_id, &target)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"appId": app_id, "path": target.to_string_lossy()}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_task_attachment(
    app: AppHandle,
    project_id: String,
    task_id: String,
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id)
        .await
        .map_err(AppError::from)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let path = match workspace::validate_attachment(&app_data, &project_id, &attachment_id).await {
        Ok(path) => path,
        Err(_) => workspace::validate_generated_attachment(&app_data, &attachment_id)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?,
    };
    workspace::open_path("system-default", &path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"attachmentId": attachment_id, "status": "opened"}))
}
