use std::path::{Component, Path, PathBuf};

use crate::PlatformError;

#[derive(Clone, Debug)]
pub struct CanonicalPathPolicy {
    root: PathBuf,
}

impl CanonicalPathPolicy {
    pub async fn new(root: impl AsRef<Path>) -> Result<Self, PlatformError> {
        let root = tokio::fs::canonicalize(root).await?;
        if !tokio::fs::metadata(&root).await?.is_dir() {
            return Err(PlatformError::Worker(
                "project root must be a directory".to_owned(),
            ));
        }
        Ok(Self { root })
    }

    pub async fn resolve_relative(&self, path: &str) -> Result<PathBuf, PlatformError> {
        let relative = Path::new(path);
        if relative.is_absolute()
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::CurDir | Component::Prefix(_)
                )
            })
        {
            return Err(PlatformError::Worker(
                "path is outside the project root".to_owned(),
            ));
        }
        let mut current = self.root.clone();
        for component in relative.components() {
            current.push(component);
            if tokio::fs::symlink_metadata(&current)
                .await?
                .file_type()
                .is_symlink()
            {
                return Err(PlatformError::Worker(
                    "symbolic links are not allowed".to_owned(),
                ));
            }
        }
        let resolved = tokio::fs::canonicalize(current).await?;
        if !resolved.starts_with(&self.root) {
            return Err(PlatformError::Worker(
                "path is outside the project root".to_owned(),
            ));
        }
        Ok(resolved)
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
}
