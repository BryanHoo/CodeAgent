use serde::{Serialize, ser::SerializeStruct, ser::Serializer};
use thiserror::Error;

use crate::infrastructure::workspace::WorkspaceError;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("runtime event channel is unavailable")]
    RuntimeChannelUnavailable,
    #[error("failed to deliver runtime event")]
    RuntimeEventDeliveryFailed,
    #[error("failed to start Codex runtime")]
    CodexRuntimeStartFailed,
    #[error("Codex runtime is unavailable")]
    CodexRuntimeUnavailable,
    #[error("Codex request failed")]
    CodexRequestFailed,
    #[error("filesystem request failed")]
    FilesystemRequestFailed,
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error("failed to resolve user home directory")]
    HomeDirectoryUnavailable,
    #[error("workbench pet asset is unavailable")]
    PetAssetUnavailable,
    #[error("workbench background is unavailable")]
    WorkbenchBackgroundUnavailable,
    #[error("failed to show desktop notification")]
    NotificationFailed,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if let Self::Workspace(error) = self {
            let mut payload = serializer.serialize_struct("AppError", 2)?;
            payload.serialize_field("code", error.code())?;
            payload.serialize_field("message", &error.to_string())?;
            return payload.end();
        }
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn workspace_error_should_preserve_code_and_message() {
        let value = serde_json::to_value(AppError::from(WorkspaceError::SnapshotMismatch)).unwrap();

        assert_eq!(
            value,
            json!({
                "code": "SNAPSHOT_MISMATCH",
                "message": "workspace snapshot changed; refresh and retry"
            })
        );
    }
}
