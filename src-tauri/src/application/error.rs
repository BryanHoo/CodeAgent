use serde::{Serialize, ser::Serializer};
use thiserror::Error;

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
    #[error("failed to resolve user home directory")]
    HomeDirectoryUnavailable,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
