use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, ipc::Channel};

use super::app_update::{CHANGELOG_URL, REPOSITORY_URL, check_for_update};
use super::state::performance_metrics::RuntimePerformanceMetricsSnapshot;
use super::{error::AppError, state::AppState};
use crate::domain::runtime::{
    AppEvent, CodexRuntimeAvailability, CodexRuntimeInstallProgress, RuntimeSnapshot,
};

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
    state.start_codex(&app, &app_data).await
}

#[tauri::command]
pub async fn inspect_codex_runtime(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CodexRuntimeAvailability, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(state.inspect_codex(&app_data).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_codex_runtime(
    app: AppHandle,
    on_progress: Channel<CodexRuntimeInstallProgress>,
    state: State<'_, AppState>,
) -> Result<CodexRuntimeAvailability, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    state
        .install_codex(&app_data, move |progress| {
            // 页面关闭不应中断已开始的本地安装，因此只忽略失效 Channel 的发送错误。
            let _ = on_progress.send(progress);
        })
        .await
}

#[tauri::command]
pub async fn get_app_info(state: State<'_, AppState>) -> Result<Value, AppError> {
    let app_version = env!("CARGO_PKG_VERSION");
    // 远程检查与本地运行时读取彼此独立，并发执行可避免叠加关于页等待时间。
    let (update, codex_version) =
        tokio::join!(check_for_update(app_version), state.codex_version(),);
    Ok(json!({
        "appVersion": app_version,
        "changelogUrl": CHANGELOG_URL,
        "codexVersion": codex_version?,
        "latestVersion": update.latest_version,
        "releaseNotes": update.release_notes,
        "releaseNotesVersion": update.release_notes_version,
        "repositoryUrl": REPOSITORY_URL,
        "status": update.status,
        "updateAvailable": update.update_available,
    }))
}

#[tauri::command]
pub async fn get_runtime_performance_metrics(
    state: State<'_, AppState>,
) -> Result<RuntimePerformanceMetricsSnapshot, AppError> {
    Ok(state.runtime_performance_metrics().await)
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_native_request(request_id: String, state: State<'_, AppState>) -> Value {
    json!({ "cancelled": state.cancel_request(&request_id) })
}

#[cfg(test)]
mod tests {
    #[test]
    fn main_window_should_allow_runtime_recovery_commands() {
        let permissions = include_str!("../../permissions/window-command-sets.toml");

        for permission in ["allow-inspect-codex-runtime", "allow-install-codex-runtime"] {
            assert!(
                permissions.contains(&format!("\"{permission}\"")),
                "main-window-commands must include {permission}"
            );
        }
    }
}
