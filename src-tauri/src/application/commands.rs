use serde_json::{Value, json};
use tauri::{State, ipc::Channel};

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
pub async fn start_runtime(state: State<'_, AppState>) -> Result<RuntimeSnapshot, AppError> {
    state.start_codex().await
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
