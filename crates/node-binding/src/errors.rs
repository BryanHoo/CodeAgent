use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use napi::{Error, Status};

pub fn to_napi_error(error: CodeAgentError) -> Error {
    let status = match error.code() {
        CodeAgentErrorCode::InvalidInput => Status::InvalidArg,
        CodeAgentErrorCode::Cancelled => Status::Cancelled,
        _ => Status::GenericFailure,
    };
    let reason = serde_json::to_string(&error.to_protocol_value()).unwrap_or_else(|_| {
        r#"{"code":"internal","message":"Native error serialization failed"}"#.to_owned()
    });
    Error::new(status, reason)
}

pub fn invalid_input(message: impl Into<String>) -> Error {
    let error = CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message.into(), None);
    to_napi_error(error)
}
