use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState};
use crate::infrastructure::filesystem::list_host_files as read_host_files;
use crate::{
    domain::conversation::AgentPromptInput,
    infrastructure::{codex, workspace},
};

#[tauri::command(rename_all = "camelCase")]
pub async fn list_host_files(
    app: AppHandle,
    kind: String,
    path: Option<String>,
    include_hidden: bool,
) -> Result<Value, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::HomeDirectoryUnavailable)?;
    let response = read_host_files(&home, path.as_deref(), &kind, include_hidden)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn upload_attachment(
    app: AppHandle,
    project_id: String,
    kind: String,
    name: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    validate_project(&state, &project_id).await?;
    let response = workspace::store_attachment(
        &app.path()
            .app_data_dir()
            .map_err(|_| AppError::FilesystemRequestFailed)?,
        &project_id,
        &kind,
        &name,
        &bytes,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn import_host_attachment(
    app: AppHandle,
    project_id: String,
    kind: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    validate_project(&state, &project_id).await?;
    let response = workspace::import_attachment(
        &app.path()
            .app_data_dir()
            .map_err(|_| AppError::FilesystemRequestFailed)?,
        &project_id,
        &kind,
        &path,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cache_project_image(
    app: AppHandle,
    project_id: String,
    root_path: Option<String>,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let project = codex::read_project(&connection, &project_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    let root = project
        .roots
        .iter()
        .find(|root| root_path.as_ref().is_none_or(|path| root.path == *path))
        .ok_or(AppError::FilesystemRequestFailed)?;
    let canonical_root = workspace::canonical_root(&root.path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let relative = Path::new(&path)
        .strip_prefix(&canonical_root)
        .ok()
        .and_then(Path::to_str)
        .unwrap_or(&path);
    let image_path = workspace::resolve_existing(&canonical_root, Some(relative))
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if !image_path.is_file() || !is_image_path(&image_path) {
        return Err(AppError::FilesystemRequestFailed);
    }
    let response = workspace::import_attachment(
        &app.path()
            .app_data_dir()
            .map_err(|_| AppError::FilesystemRequestFailed)?,
        &project_id,
        "image",
        image_path
            .to_str()
            .ok_or(AppError::FilesystemRequestFailed)?,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::FilesystemRequestFailed)
}

pub async fn resolve_prompt_attachments(
    app_data: &Path,
    project_id: &str,
    input: &mut AgentPromptInput,
) -> Result<(), AppError> {
    for attachment in &mut input.attachments {
        let object = attachment
            .as_object_mut()
            .ok_or(AppError::FilesystemRequestFailed)?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .ok_or(AppError::FilesystemRequestFailed)?;
        let path = workspace::validate_attachment(app_data, project_id, id)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        let path_string = path.to_string_lossy().into_owned();
        object.insert("id".to_owned(), Value::String(path_string.clone()));
        if is_image_path(&path) {
            object.insert("kind".to_owned(), Value::String("image".to_owned()));
        } else {
            let metadata = tokio::fs::metadata(&path)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            if metadata.len() > 1024 * 1024 {
                return Err(AppError::FilesystemRequestFailed);
            }
            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or(AppError::FilesystemRequestFailed)?;
            object.insert("kind".to_owned(), Value::String("text".to_owned()));
            object.insert(
                "content".to_owned(),
                Value::String(format!("<file path=\"{name}\">\n{content}\n</file>")),
            );
        }
    }
    Ok(())
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp"
            )
        })
}

async fn validate_project(state: &State<'_, AppState>, project_id: &str) -> Result<(), AppError> {
    let connection = state.codex_connection().await?;
    codex::read_project(&connection, project_id)
        .await
        .map(|_| ())
        .map_err(|_| AppError::CodexRequestFailed)
}
