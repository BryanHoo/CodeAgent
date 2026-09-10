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
    let settings = codex::read_agent_runtime_settings(connection)
        .await
        .map_err(AppError::from)?;
    let temporary_cwd = if project_id == TEMPORARY_PROJECT_ID {
        Some(
            temporary_workspace::create(&app_data)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?,
        )
    } else {
        None
    };

    match codex::start_task(connection, project_id, temporary_cwd.as_deref(), &settings).await {
        Ok(response) => {
            if let Some(cwd) = temporary_cwd {
                let workspace = match temporary_workspace::bind_task(
                    &app_data,
                    &cwd,
                    &response.task.id,
                )
                .await
                {
                    Ok(workspace) => workspace,
                    Err(_) => {
                        let _ = codex::delete_task(
                            connection,
                            TEMPORARY_PROJECT_ID.to_owned(),
                            response.task.id,
                        )
                        .await;
                        let _ = temporary_workspace::remove(&app_data, &cwd).await;
                        return Err(AppError::FilesystemRequestFailed);
                    }
                };
                if let Err(error) =
                    codex::update_task_workspace(connection, &response.task.id, &workspace).await
                {
                    let _ = codex::delete_task(
                        connection,
                        TEMPORARY_PROJECT_ID.to_owned(),
                        response.task.id,
                    )
                    .await;
                    let _ = temporary_workspace::remove(&app_data, &workspace).await;
                    return Err(AppError::from(error));
                }
                allow_attachment_assets(app, TEMPORARY_PROJECT_ID, &response.task.id).await?;
            }
            Ok(response)
        }
        Err(error) => {
            if let Some(cwd) = temporary_cwd {
                let _ = temporary_workspace::remove(&app_data, &cwd).await;
            }
            Err(AppError::from(error))
        }
    }
}

pub(crate) async fn allow_attachment_assets(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    if let Some(root) = crate::infrastructure::temporary_task_storage::root(
        &app_data_dir(app)?,
        project_id,
        task_id,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        // 仅开放已登记任务的附件目录，不扩大到用户选择的整个文件夹。
        app.asset_protocol_scope()
            .allow_directory(root.join("attachments"), true)
            .map_err(|_| AppError::FilesystemRequestFailed)?;
    }
    Ok(())
}

pub(crate) async fn remove_deleted_workspace(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
    working_directory: Option<&Path>,
) -> Result<(), AppError> {
    if project_id != TEMPORARY_PROJECT_ID {
        return Ok(());
    }
    let Some(working_directory) = working_directory else {
        return Ok(());
    };
    let app_data = app_data_dir(app)?;
    if let Some(owned) =
        crate::infrastructure::temporary_workspace_settings::task_workspace(&app_data, task_id)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        return temporary_workspace::remove(&app_data, &owned)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed);
    }
    // 未登记的历史分叉可能共用父任务目录；不允许按另一个任务的 ID 清理。
    if working_directory
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name != task_id && !name.starts_with("task-"))
    {
        return Ok(());
    }
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
