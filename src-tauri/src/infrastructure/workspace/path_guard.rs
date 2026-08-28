use std::path::{Component, Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("invalid workspace path")]
    InvalidPath,
    #[error("workspace snapshot changed; refresh and retry")]
    SnapshotMismatch,
    #[error("invalid Git branch name")]
    InvalidBranch,
    #[error("current branch has no upstream")]
    NoUpstream,
    #[error("{0}")]
    GitCommandFailed(String),
    #[error("workspace I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

impl WorkspaceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPath => "INVALID_PATH",
            Self::SnapshotMismatch => "SNAPSHOT_MISMATCH",
            Self::InvalidBranch => "INVALID_BRANCH",
            Self::NoUpstream => "NO_UPSTREAM",
            Self::GitCommandFailed(_) => "GIT_COMMAND_FAILED",
            Self::Io(_) => "IO_FAILED",
        }
    }
}

pub async fn canonical_root(path: &str) -> Result<PathBuf, WorkspaceError> {
    let root = tokio::fs::canonicalize(path).await?;
    if !tokio::fs::metadata(&root).await?.is_dir() {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(root)
}

pub async fn resolve_existing(
    root: &Path,
    relative: Option<&str>,
) -> Result<PathBuf, WorkspaceError> {
    let candidate = match relative {
        Some(relative) => root.join(valid_relative(relative)?),
        None => root.to_path_buf(),
    };
    let resolved = tokio::fs::canonicalize(candidate).await?;
    if !resolved.starts_with(root) {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(resolved)
}

pub async fn resolve_destination(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let candidate = root.join(valid_relative(relative)?);
    let parent = candidate.parent().ok_or(WorkspaceError::InvalidPath)?;
    let resolved_parent = tokio::fs::canonicalize(parent).await?;
    if !resolved_parent.starts_with(root) {
        return Err(WorkspaceError::InvalidPath);
    }
    let name = candidate.file_name().ok_or(WorkspaceError::InvalidPath)?;
    Ok(resolved_parent.join(name))
}

pub fn valid_relative(value: &str) -> Result<PathBuf, WorkspaceError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || value.contains('\\')
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(path.to_path_buf())
}

pub fn relative_string(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    path.strip_prefix(root)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .to_str()
        .filter(|value| !value.is_empty())
        .map(|value| value.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or(WorkspaceError::InvalidPath)
}
