use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
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
            message: error.message().to_owned(),
            retryable,
        }
    }
}
