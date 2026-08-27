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
