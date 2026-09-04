use std::{
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use tokio::fs;

const WORKSPACE_DIRECTORY: &str = "temporary-workspaces";
const WORKSPACE_PREFIX: &str = "task-";
static WORKSPACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub async fn create(app_data: &Path) -> io::Result<PathBuf> {
    let root = app_data.join(WORKSPACE_DIRECTORY);
    fs::create_dir_all(&root).await?;
    let root = fs::canonicalize(root).await?;

    for _ in 0..32 {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let workspace = root.join(format!(
            "{WORKSPACE_PREFIX}{timestamp}-{}-{sequence}",
            std::process::id()
        ));
        match fs::create_dir(&workspace).await {
            Ok(()) => return Ok(workspace),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "failed to allocate a unique temporary workspace",
    ))
}

pub async fn canonical_workspace(app_data: &Path, workspace: &Path) -> io::Result<PathBuf> {
    let root = fs::canonicalize(app_data.join(WORKSPACE_DIRECTORY)).await?;
    let workspace = fs::canonicalize(workspace).await?;
    let has_managed_name = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(WORKSPACE_PREFIX));

    // 仅接受受控根目录的直接子目录，阻止路径穿越和符号链接逃逸。
    if workspace.parent() != Some(root.as_path())
        || !has_managed_name
        || !fs::metadata(&workspace).await?.is_dir()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "temporary workspace is outside the managed directory",
        ));
    }
    Ok(workspace)
}

pub async fn remove(app_data: &Path, workspace: &Path) -> io::Result<()> {
    match canonical_workspace(app_data, workspace).await {
        Ok(workspace) => fs::remove_dir_all(workspace).await,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "codeagent-{name}-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[tokio::test]
    async fn creates_and_removes_only_managed_workspaces() {
        let app_data = test_root("temporary-workspace");
        let workspace = create(&app_data).await.unwrap();
        fs::write(workspace.join("notes.md"), "content")
            .await
            .unwrap();

        assert_eq!(
            canonical_workspace(&app_data, &workspace).await.unwrap(),
            workspace
        );
        remove(&app_data, &workspace).await.unwrap();
        assert!(!workspace.exists());

        let _ = fs::remove_dir_all(app_data).await;
    }

    #[tokio::test]
    async fn rejects_directories_outside_the_managed_root() {
        let app_data = test_root("temporary-workspace-boundary");
        let workspace = create(&app_data).await.unwrap();
        let outside = app_data.join("task-outside");
        fs::create_dir_all(&outside).await.unwrap();

        assert_eq!(
            canonical_workspace(&app_data, &outside)
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        assert!(outside.exists());

        let _ = remove(&app_data, &workspace).await;
        let _ = fs::remove_dir_all(app_data).await;
    }
}
