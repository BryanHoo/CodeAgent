use tauri::{State, ipc::Channel};

use super::{error::AppError, state::AppState};
use crate::domain::runtime::{AppEvent, RuntimeSnapshot};

#[tauri::command(rename_all = "camelCase")]
pub fn connect_runtime(
    on_event: Channel<AppEvent>,
    state: State<'_, AppState>,
) -> Result<RuntimeSnapshot, AppError> {
    state.connect(on_event)
}
