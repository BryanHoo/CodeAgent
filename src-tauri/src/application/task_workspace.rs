use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::{error::AppError, state::AppState};
use crate::{
    domain::sidebar::AgentTaskMutationResponse,
    infrastructure::{codex, temporary_workspace, workspace},
};

pub(crate) const TEMPORARY_PROJECT_ID: &str = "temporary";

pub(crate) async fn start_task(
    app: &AppHandle,
    connection: &codex::AppServerConnection,
    project_id: String,
) -> Result<AgentTaskMutationResponse, AppError> {
    let app_data = app_data_dir(app)?;
    let temporary_cwd = if project_id == TEMPORARY_PROJECT_ID {
        Some(
            temporary_workspace::create(&app_data)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?,
        )
    } else {
        None
    };

    match codex::start_task(connection, project_id, temporary_cwd.as_deref()).await {
        Ok(response) => Ok(response),
        Err(error) => {
            if let Some(cwd) = temporary_cwd {
                let _ = temporary_workspace::remove(&app_data, &cwd).await;
            }
            Err(AppError::from(error))
        }
    }
}

pub(crate) async fn remove_deleted_workspace(
    app: &AppHandle,
    project_id: &str,
    working_directory: Option<&Path>,
) -> Result<(), AppError> {
    if project_id != TEMPORARY_PROJECT_ID {
        return Ok(());
    }
    let Some(working_directory) = working_directory else {
        return Ok(());
    };
    let app_data = app_data_dir(app)?;
    match temporary_workspace::canonical_workspace(&app_data, working_directory).await {
        Ok(workspace) => temporary_workspace::remove(&app_data, &workspace)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed),
        // 历史任务可能保存了旧版安装目录 cwd；删除线程时只能跳过，绝不能扩大清理范围。
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
            ) =>
        {
            Ok(())
        }
        Err(_) => Err(AppError::FilesystemRequestFailed),
    }
}

pub(crate) async fn resolve_preview_root(
    app: &AppHandle,
    state: &AppState,
    project_id: &str,
    task_id: Option<&str>,
    root_path: Option<&str>,
    path: &str,
) -> Result<PathBuf, AppError> {
    let connection = state.codex_connection().await?;
    if project_id == TEMPORARY_PROJECT_ID {
        if root_path.is_some() {
            return Err(AppError::FilesystemRequestFailed);
        }
        let task_id = task_id.ok_or(AppError::FilesystemRequestFailed)?;
        let cwd = codex::task_working_directory(&connection, project_id, task_id)
            .await
            .map_err(AppError::from)?;
        return temporary_workspace::canonical_workspace(&app_data_dir(app)?, &cwd)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed);
    }

    let project = codex::read_project(&connection, project_id)
        .await
        .map_err(AppError::from)?;
    let configured_root = match root_path {
        Some(root_path) => project
            .roots
            .into_iter()
            .find(|root| root.path == root_path),
        None => project
            .roots
            .into_iter()
            .find(|root| PathBuf::from(path).starts_with(&root.path)),
    }
    .ok_or(AppError::FilesystemRequestFailed)?;
    workspace::canonical_root(&configured_root.path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

pub(crate) fn relative_preview_path(root: &Path, path: &str) -> Result<String, AppError> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Ok(path.to_owned());
    }
    candidate
        .strip_prefix(root)
        .map(|relative| relative.to_string_lossy().into_owned())
        .map_err(|_| AppError::FilesystemRequestFailed)
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}
