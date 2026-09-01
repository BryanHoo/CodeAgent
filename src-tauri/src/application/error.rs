use serde::{Serialize, ser::SerializeStruct, ser::Serializer};
use thiserror::Error;

use crate::infrastructure::{codex::ConnectionError, workspace::WorkspaceError};

#[derive(Debug, Error)]
pub enum AppError {
    #[error("runtime event channel is unavailable")]
    RuntimeChannelUnavailable,
    #[error("failed to deliver runtime event")]
    RuntimeEventDeliveryFailed,
    #[error("failed to start Codex runtime")]
    CodexRuntimeStartFailed,
    #[error("failed to install Codex runtime")]
    CodexRuntimeInstallFailed,
    #[error("failed to check for a CodeAgent update")]
    AppUpdateCheckFailed,
    #[error("the selected CodeAgent update is no longer available")]
    AppUpdateUnavailable,
    #[error("failed to install the CodeAgent update")]
    AppUpdateInstallFailed,
    #[error("Codex runtime is unavailable")]
    CodexRuntimeUnavailable,
    #[error("Codex request failed")]
    CodexRequestFailed,
    #[error("Codex thread is active in another session")]
    CodexThreadBusy,
    #[error("native request was cancelled")]
    RequestCancelled,
    #[error("filesystem request failed")]
    FilesystemRequestFailed,
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error("failed to resolve user home directory")]
    HomeDirectoryUnavailable,
    #[error("workbench pet asset is unavailable")]
    PetAssetUnavailable,
    #[error("desktop pet window operation failed")]
    DesktopPetWindowFailed,
    #[error("workbench background is unavailable")]
    WorkbenchBackgroundUnavailable,
    #[error("failed to show desktop notification")]
    NotificationFailed,
    #[error("tray operation failed")]
    TrayOperationFailed,
    #[error("failed to export diagnostics")]
    DiagnosticsExportFailed,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let structured_error = match self {
            Self::CodexThreadBusy => Some(("CODEX_THREAD_BUSY", self.to_string())),
            Self::RequestCancelled => Some(("REQUEST_CANCELLED", self.to_string())),
            Self::Workspace(error) => Some((error.code(), error.to_string())),
            _ => None,
        };
        if let Some((code, message)) = structured_error {
            let mut payload = serializer.serialize_struct("AppError", 2)?;
            payload.serialize_field("code", code)?;
            payload.serialize_field("message", &message)?;
            return payload.end();
        }
        serializer.serialize_str(&self.to_string())
    }
}

impl From<ConnectionError> for AppError {
    fn from(error: ConnectionError) -> Self {
        // active writer 是用户可处理的会话冲突，其余 Provider 细节继续留在后端边界。
        match error {
            ConnectionError::Request {
                code: -32600,
                message,
            } if message.starts_with("thread ")
                && message.ends_with(" already has an active writer") =>
            {
                Self::CodexThreadBusy
            }
            _ => Self::CodexRequestFailed,
        }
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

    #[test]
    fn missing_git_should_preserve_recoverable_error_details() {
        let value = serde_json::to_value(AppError::from(WorkspaceError::GitNotFound)).unwrap();

        assert_eq!(
            value,
            json!({
                "code": "GIT_NOT_FOUND",
                "message": "Git was not found; install Git and restart CodeAgent"
            })
        );
    }

    #[test]
    fn active_thread_writer_should_preserve_a_stable_error_code() {
        let error = crate::infrastructure::codex::ConnectionError::Request {
            code: -32600,
            message: "thread thread-a already has an active writer".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(AppError::from(error)).unwrap(),
            json!({
                "code": "CODEX_THREAD_BUSY",
                "message": "Codex thread is active in another session"
            })
        );
    }

    #[test]
    fn unrelated_codex_errors_should_remain_generic() {
        let error = crate::infrastructure::codex::ConnectionError::Request {
            code: -32600,
            message: "invalid turn options".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(AppError::from(error)).unwrap(),
            json!("Codex request failed")
        );
    }
}
