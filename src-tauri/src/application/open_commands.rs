use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use super::{
    error::AppError,
    state::AppState,
    task_workspace::{self, TEMPORARY_PROJECT_ID},
    workspace_commands::project_root,
};
use crate::infrastructure::{codex, workspace};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectInput {
    app_id: String,
    fallback_to_existing_ancestor: Option<bool>,
    path: Option<String>,
    task_id: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_open_capabilities() -> Result<Value, AppError> {
    let (platform, apps) = workspace::platform_apps();
    Ok(json!({"apps": apps, "platform": platform}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_project(
    app: AppHandle,
    project_id: String,
    root_path: Option<String>,
    input: OpenProjectInput,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let OpenProjectInput {
        app_id,
        fallback_to_existing_ancestor,
        path,
        task_id,
    } = input;
    let root = if project_id == TEMPORARY_PROJECT_ID {
        // 临时任务没有 Project root，必须通过线程 cwd 回到受控工作区。
        task_workspace::resolve_preview_root(
            &app,
            &state,
            &project_id,
            task_id.as_deref(),
            root_path.as_deref(),
            path.as_deref().unwrap_or_default(),
        )
        .await?
    } else {
        match root_path {
            Some(root_path) => project_root(&state, &project_id, &root_path).await?.1,
            None => {
                let connection = state.codex_connection().await?;
                let project = codex::read_project(&connection, &project_id)
                    .await
                    .map_err(AppError::from)?;
                let root = project
                    .roots
                    .first()
                    .ok_or(AppError::FilesystemRequestFailed)?;
                workspace::canonical_root(&root.path)
                    .await
                    .map_err(|_| AppError::FilesystemRequestFailed)?
            }
        }
    };
    let target = match path {
        Some(path) => {
            let candidate = if Path::new(&path).is_absolute() {
                PathBuf::from(path)
            } else {
                root.join(path)
            };
            resolve_open_target(
                &root,
                candidate,
                fallback_to_existing_ancestor.unwrap_or(false),
            )
            .await?
        }
        None => root,
    };
    workspace::open_path(&app_id, &target)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"appId": app_id, "path": target.to_string_lossy()}))
}

async fn resolve_open_target(
    root: &Path,
    candidate: PathBuf,
    fallback_to_existing_ancestor: bool,
) -> Result<PathBuf, AppError> {
    let mut current = candidate;
    loop {
        match tokio::fs::canonicalize(&current).await {
            Ok(resolved) if resolved.starts_with(root) => return Ok(resolved),
            Ok(_) => return Err(AppError::FilesystemRequestFailed),
            Err(error)
                if fallback_to_existing_ancestor
                    && error.kind() == std::io::ErrorKind::NotFound =>
            {
                // 生成失败可能连目标目录都未创建，只回退到受控根内最近存在的祖先。
                current = current
                    .parent()
                    .filter(|parent| *parent != current)
                    .map(Path::to_path_buf)
                    .ok_or(AppError::FilesystemRequestFailed)?;
            }
            Err(_) => return Err(AppError::FilesystemRequestFailed),
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_task_attachment(
    app: AppHandle,
    project_id: String,
    task_id: String,
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(AppError::from)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let path = match crate::infrastructure::temporary_task_storage::validate_attachment(
        &app_data,
        &project_id,
        &task_id,
        &attachment_id,
    )
    .await
    {
        Ok(path) => path,
        Err(_) => workspace::validate_generated_attachment(&app_data, &attachment_id)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?,
    };
    workspace::open_path("system-default", &path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"attachmentId": attachment_id, "status": "opened"}))
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::resolve_open_target;

    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("codeagent-{name}-{nonce}"))
    }

    #[tokio::test]
    async fn containing_folder_should_fall_back_to_existing_workspace_ancestor() {
        let root = test_directory("open-containing-folder");
        tokio::fs::create_dir_all(&root)
            .await
            .expect("test root should be created");
        let root = tokio::fs::canonicalize(&root)
            .await
            .expect("test root should resolve");

        let target = resolve_open_target(&root, root.join("missing/output"), true)
            .await
            .expect("missing folder should fall back to the managed workspace");

        assert_eq!(target, root);
        tokio::fs::remove_dir_all(&root)
            .await
            .expect("test root should be removed");
    }
}
