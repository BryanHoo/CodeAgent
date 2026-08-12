use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use napi::{Error, Status};

pub fn to_napi_error(error: CodeAgentError) -> Error {
    let status = match error.code() {
        CodeAgentErrorCode::InvalidInput => Status::InvalidArg,
        CodeAgentErrorCode::Cancelled => Status::Cancelled,
        _ => Status::GenericFailure,
    };
    let correlation = error
        .correlation_id()
        .map_or_else(String::new, |id| format!("; correlationId={id}"));
    Error::new(
        status,
        format!("{}: {}{correlation}", error.code(), error.message()),
    )
}

pub fn invalid_input(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}
