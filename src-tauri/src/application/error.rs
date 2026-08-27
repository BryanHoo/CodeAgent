use serde::{Serialize, ser::Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("runtime state is unavailable")]
    RuntimeStateUnavailable,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
