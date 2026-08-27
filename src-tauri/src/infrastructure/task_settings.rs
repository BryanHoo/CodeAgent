use std::{
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs;

use crate::domain::conversation::AgentTaskSettings;

static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
pub enum TaskSettingsError {
    #[error("invalid task settings identifier")]
    InvalidIdentifier,
    #[error("invalid task settings data")]
    InvalidData,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTaskSettings {
    project_id: String,
    settings: AgentTaskSettings,
    task_id: String,
}

pub async fn read_task_settings(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<Option<AgentTaskSettings>, TaskSettingsError> {
    let path = settings_path(app_data, project_id, task_id)?;
    let bytes = match fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let stored: StoredTaskSettings = serde_json::from_slice(&bytes)?;
    if stored.project_id != project_id || stored.task_id != task_id || !stored.settings.is_valid() {
        return Err(TaskSettingsError::InvalidData);
    }
    Ok(Some(stored.settings))
}

pub async fn write_task_settings(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
    settings: &AgentTaskSettings,
) -> Result<(), TaskSettingsError> {
    if !settings.is_valid() {
        return Err(TaskSettingsError::InvalidData);
    }
    let target = settings_path(app_data, project_id, task_id)?;
    let parent = target
        .parent()
        .ok_or(TaskSettingsError::InvalidIdentifier)?;
    fs::create_dir_all(parent).await?;
    let stored = StoredTaskSettings {
        project_id: project_id.to_owned(),
        settings: settings.clone(),
        task_id: task_id.to_owned(),
    };
    let bytes = serde_json::to_vec(&stored)?;
    let temp = temporary_path(parent, task_id);
    fs::write(&temp, bytes).await?;

    // 同目录 rename 在 Unix 上原子替换；Windows 已存在目标时使用最小回退路径。
    if let Err(error) = fs::rename(&temp, &target).await {
        if error.kind() != io::ErrorKind::AlreadyExists
            && error.kind() != io::ErrorKind::PermissionDenied
        {
            let _ = fs::remove_file(&temp).await;
            return Err(error.into());
        }
        match fs::remove_file(&target).await {
            Ok(()) => fs::rename(&temp, &target).await?,
            Err(remove_error) if remove_error.kind() == io::ErrorKind::NotFound => {
                fs::rename(&temp, &target).await?
            }
            Err(remove_error) => {
                let _ = fs::remove_file(&temp).await;
                return Err(remove_error.into());
            }
        }
    }
    Ok(())
}

pub async fn delete_task_settings(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<(), TaskSettingsError> {
    let path = settings_path(app_data, project_id, task_id)?;
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub async fn delete_project_task_settings(
    app_data: &Path,
    project_id: &str,
) -> Result<(), TaskSettingsError> {
    let path = project_path(app_data, project_id)?;
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn settings_path(
    app_data: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<PathBuf, TaskSettingsError> {
    if !valid_identifier(task_id) {
        return Err(TaskSettingsError::InvalidIdentifier);
    }
    Ok(project_path(app_data, project_id)?.join(format!("{task_id}.json")))
}

fn project_path(app_data: &Path, project_id: &str) -> Result<PathBuf, TaskSettingsError> {
    if !valid_identifier(project_id) {
        return Err(TaskSettingsError::InvalidIdentifier);
    }
    Ok(app_data.join("task-settings").join(project_id))
}

fn temporary_path(parent: &Path, task_id: &str) -> PathBuf {
    let id = TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(".{task_id}.{}.{id}.tmp", std::process::id()))
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
