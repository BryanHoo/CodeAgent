use serde::{Serialize, ser::Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("runtime event channel is unavailable")]
    RuntimeChannelUnavailable,
    #[error("failed to deliver runtime event")]
    RuntimeEventDeliveryFailed,
    #[error("failed to resolve application data directory")]
    AppDataDirectoryUnavailable,
    #[error("failed to start Codex runtime")]
    CodexRuntimeStartFailed,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
