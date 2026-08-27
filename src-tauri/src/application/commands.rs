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
        .map_err(|_| AppError::AppDataDirectoryUnavailable)?;
    let codex_home = app_data.join("providers").join("codex").join("runtime");
    state.start_codex(&codex_home).await
}
