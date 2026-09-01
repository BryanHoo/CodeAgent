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
    #[error("Git was not found; install Git and restart CodeAgent")]
    GitNotFound,
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
            Self::GitNotFound => "GIT_NOT_FOUND",
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

pub async fn resolve_destination(root: &Path, relative: &Path) -> Result<PathBuf, WorkspaceError> {
    let candidate = root.join(normalize_relative(relative)?);
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
    if value.is_empty() || path.is_absolute() || value.contains('\\') {
        return Err(WorkspaceError::InvalidPath);
    }
    normalize_relative(path)
}

fn normalize_relative(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        let Component::Normal(component) = component else {
            return Err(WorkspaceError::InvalidPath);
        };
        normalized.push(component);
    }
    (!normalized.as_os_str().is_empty())
        .then_some(normalized)
        .ok_or(WorkspaceError::InvalidPath)
}

pub fn relative_string(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    path.strip_prefix(root)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .to_str()
        .filter(|value| !value.is_empty())
        .map(|value| value.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or(WorkspaceError::InvalidPath)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_protocol_paths_should_use_native_components() {
        assert_eq!(
            valid_relative("src/main.rs").unwrap(),
            PathBuf::from("src").join("main.rs")
        );
    }
}
