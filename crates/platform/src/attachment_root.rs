use std::path::{Path, PathBuf};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use tokio::sync::OnceCell;

pub(crate) struct AttachmentRoot {
    configured: PathBuf,
    resolved: OnceCell<PathBuf>,
}

impl AttachmentRoot {
    pub(crate) fn new(root: impl AsRef<Path>) -> Result<Self, CodeAgentError> {
        let root = root.as_ref();
        if !root.is_absolute() {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::InvalidInput,
                "attachment root must be absolute",
                None,
            ));
        }
        Ok(Self {
            configured: root.to_path_buf(),
            resolved: OnceCell::new(),
        })
    }

    pub(crate) async fn resolve(&self) -> Result<&Path, CodeAgentError> {
        self.resolved
            .get_or_try_init(|| async {
                tokio::fs::create_dir_all(&self.configured)
                    .await
                    .map_err(|_| {
                        CodeAgentError::internal("attachment root could not be created")
                    })?;
                tokio::fs::canonicalize(&self.configured)
                    .await
                    .map_err(|_| CodeAgentError::internal("attachment root could not be resolved"))
            })
            .await
            .map(PathBuf::as_path)
    }

    pub(crate) fn resolved(&self) -> Option<&Path> {
        self.resolved.get().map(PathBuf::as_path)
    }

    pub(crate) async fn remove_files(&self, paths: Vec<PathBuf>) -> Result<(), CodeAgentError> {
        let root = self
            .resolved()
            .ok_or_else(|| CodeAgentError::internal("attachment root is unavailable"))?;
        for path in paths {
            // path 只来自随机 ID，删除前仍验证位于 canonical 受管根内。
            if path.parent() != Some(root) {
                return Err(CodeAgentError::internal(
                    "attachment cleanup escaped managed root",
                ));
            }
            match tokio::fs::remove_file(path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(CodeAgentError::internal("attachment cleanup failed")),
            }
        }
        Ok(())
    }
}
