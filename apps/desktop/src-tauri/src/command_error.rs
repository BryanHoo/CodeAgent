use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub correlation_id: String,
    pub message: String,
    pub retryable: bool,
}

impl CommandError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message, false)
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message, false)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message, false)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message, false)
    }

    pub fn update_check_failed(message: impl Into<String>) -> Self {
        Self::new("update_check_failed", message, true)
    }

    pub fn update_install_failed(message: impl Into<String>) -> Self {
        Self::new("update_install_failed", message, true)
    }

    pub fn update_not_available() -> Self {
        Self::new(
            "update_not_available",
            "The requested update is not available",
            false,
        )
    }

    fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_owned(),
            correlation_id: Uuid::new_v4().to_string(),
            message: message.into(),
            retryable,
        }
    }
}

impl From<code_agent_core::CodeAgentError> for CommandError {
    fn from(error: code_agent_core::CodeAgentError) -> Self {
        let retryable = matches!(
            error.code(),
            code_agent_core::CodeAgentErrorCode::CapacityExceeded
                | code_agent_core::CodeAgentErrorCode::ProviderFailure
                | code_agent_core::CodeAgentErrorCode::Timeout
        );
        Self {
            code: error.code().to_string(),
            correlation_id: error
                .correlation_id()
                .map(str::to_owned)
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            message: error.message().to_owned(),
            retryable,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
    use uuid::Uuid;

    use super::CommandError;

    #[test]
    fn preserves_messages_and_correlation_ids() {
        let existing = CommandError::from(CodeAgentError::new(
            CodeAgentErrorCode::Internal,
            "/secret/path failed",
            Some(Arc::from("trace-existing")),
        ));
        assert_eq!(existing.correlation_id, "trace-existing");
        assert_eq!(existing.message, "/secret/path failed");

        let generated = CommandError::invalid_input("bad field");
        assert!(Uuid::parse_str(&generated.correlation_id).is_ok());
        assert_eq!(generated.message, "bad field");
    }
}
