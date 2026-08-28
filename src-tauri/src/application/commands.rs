use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, ipc::Channel};

use super::{error::AppError, state::AppState};
use crate::domain::runtime::{AppEvent, RuntimeSnapshot};

#[tauri::command(rename_all = "camelCase")]
pub async fn connect_runtime(
    on_event: Channel<AppEvent>,
    state: State<'_, AppState>,
) -> Result<RuntimeSnapshot, AppError> {
    Ok(state.connect(on_event).await)
}

#[tauri::command]
pub async fn start_runtime(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RuntimeSnapshot, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    state.start_codex(&app_data).await
}

#[tauri::command]
pub async fn get_app_info(state: State<'_, AppState>) -> Result<Value, AppError> {
    Ok(json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "codexVersion": state.codex_version().await?,
        "latestVersion": null,
        "releaseNotes": null,
        "status": "current",
        "updateAvailable": false,
    }))
}
