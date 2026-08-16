use std::path::{Path, PathBuf};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};

pub async fn ensure_temporary_workspace(path: &Path) -> Result<PathBuf, CodeAgentError> {
    if !path.is_absolute() {
        return Err(CodeAgentError::new(
            CodeAgentErrorCode::InvalidInput,
            "temporary workspace must be absolute",
            None,
        ));
    }
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || create_private_directory(&path))
        .await
        .map_err(|_| CodeAgentError::internal("temporary workspace task failed"))?
}

fn create_private_directory(path: &Path) -> Result<PathBuf, CodeAgentError> {
    create_directory_tree(path)?;
    let metadata = std::fs::symlink_metadata(path).map_err(|_| {
        CodeAgentError::internal("temporary workspace could not be read")
    })?;
    if metadata.file_type().is_symlink() {
        return Err(CodeAgentError::new(
            CodeAgentErrorCode::InvalidInput,
            "temporary workspace must not be a symbolic link",
            None,
        ));
    }
    if !metadata.is_dir() {
        return Err(CodeAgentError::new(
            CodeAgentErrorCode::InvalidInput,
            "temporary workspace path must be a directory",
            None,
        ));
    }
    apply_private_permissions(path)?;
    std::fs::canonicalize(path).map_err(|_| {
        CodeAgentError::internal("temporary workspace could not be resolved")
    })
}

#[cfg(unix)]
fn create_directory_tree(path: &Path) -> Result<(), CodeAgentError> {
    use std::os::unix::fs::DirBuilderExt;

    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    builder.mode(0o700);
    builder.create(path).map_err(|_| {
        CodeAgentError::internal("temporary workspace could not be created")
    })
}

#[cfg(not(unix))]
fn create_directory_tree(path: &Path) -> Result<(), CodeAgentError> {
    std::fs::create_dir_all(path).map_err(|_| {
        CodeAgentError::internal("temporary workspace could not be created")
    })
}

#[cfg(unix)]
fn apply_private_permissions(path: &Path) -> Result<(), CodeAgentError> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(|_| {
        CodeAgentError::internal("temporary workspace permissions could not be applied")
    })
}

#[cfg(not(unix))]
fn apply_private_permissions(_path: &Path) -> Result<(), CodeAgentError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::ensure_temporary_workspace;

    fn unique_workspace_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "code-agent-temporary-workspace-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock must follow unix epoch")
                .as_nanos()
        ))
    }

    #[tokio::test(flavor = "current_thread")]
    async fn ensure_temporary_workspace_creates_private_directory() {
        let root = unique_workspace_root();
        let created = ensure_temporary_workspace(&root)
            .await
            .expect("temporary workspace must be created");
        assert_eq!(created, fs::canonicalize(&root).expect("canonical path"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mode = fs::metadata(&root)
                .expect("workspace metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn ensure_temporary_workspace_rejects_symbolic_link_target() {
        let root = unique_workspace_root();
        let target = root.join("target");
        let alias = root.join("alias");
        fs::create_dir_all(&root).expect("fixture root");
        fs::create_dir_all(&target).expect("fixture target");
        std::os::unix::fs::symlink(&target, &alias).expect("fixture symlink");

        let error = ensure_temporary_workspace(&alias)
            .await
            .expect_err("symbolic link must be rejected");
        assert_eq!(
            error.message(),
            "temporary workspace must not be a symbolic link"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
