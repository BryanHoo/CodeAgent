use tauri::{AppHandle, Manager, State};

use super::{error::AppError, state::AppState, task_subscription::unsubscribe_retry_delay};
use crate::infrastructure::codex;

#[tauri::command(rename_all = "camelCase")]
pub async fn retain_task_subscription(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if task_id.is_empty() || task_id.len() > 128 {
        return Err(AppError::CodexRequestFailed);
    }
    state.retain_task_subscription(&task_id).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn release_task_subscription(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if project_id.is_empty() || project_id.len() > 128 || task_id.is_empty() || task_id.len() > 128
    {
        return Err(AppError::CodexRequestFailed);
    }
    let generation = state.release_task_subscription(&task_id).await;
    spawn_task_subscription_release(app, project_id, task_id, generation);
    Ok(())
}

pub(super) fn spawn_task_subscription_release(
    app: AppHandle,
    project_id: String,
    task_id: String,
    generation: u64,
) {
    tauri::async_runtime::spawn(run_task_subscription_release(
        app, project_id, task_id, generation,
    ));
}

async fn run_task_subscription_release(
    app: AppHandle,
    project_id: String,
    task_id: String,
    generation: u64,
) {
    let mut attempt = 0;
    loop {
        let state = app.state::<AppState>();
        if !state
            .is_task_subscription_release_current(&task_id, generation)
            .await
        {
            return;
        }
        let result = match state.codex_connection().await {
            Ok(connection) => codex::unsubscribe_task(&connection, &project_id, &task_id).await,
            Err(_) => {
                tokio::time::sleep(unsubscribe_retry_delay(attempt)).await;
                attempt = attempt.saturating_add(1);
                continue;
            }
        };
        match result {
            Ok(response) if response.status != "busy" => {
                state
                    .complete_task_subscription_release(&task_id, generation)
                    .await;
                return;
            }
            Ok(_) | Err(_) => {
                tokio::time::sleep(unsubscribe_retry_delay(attempt)).await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}
