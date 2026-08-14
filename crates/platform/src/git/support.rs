use std::path::Path;

use code_agent_core::{AgentMutationErrorCode, CodeAgentError, CodeAgentErrorCode};
use serde_json::Value;

use crate::PlatformError;

pub(super) fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let value = value.trim();
    if value.is_empty() { fallback } else { value }
}

pub(super) fn parse_cursor(value: Option<&Value>) -> Result<usize, CodeAgentError> {
    match value.and_then(Value::as_str) {
        None => Ok(0),
        Some(value) => value.parse().map_err(|_| invalid("git cursor is invalid")),
    }
}

pub(super) fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CodeAgentError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("git request is invalid"))
}

pub(super) fn optional_string<'a>(
    value: &'a Value,
    key: &str,
) -> Result<Option<&'a str>, CodeAgentError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(Some)
            .ok_or_else(|| invalid("git request is invalid")),
    }
}

pub(super) fn validate_sha(value: &str) -> Result<(), CodeAgentError> {
    if (40..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(invalid("git commit SHA is invalid"))
    }
}

pub(super) fn valid_relative_path(value: &str) -> Result<&str, CodeAgentError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        Err(invalid("git path is invalid"))
    } else {
        Ok(value)
    }
}

pub(super) fn truncate_utf8(value: String, maximum: usize) -> (String, bool) {
    if value.len() <= maximum {
        return (value, false);
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_owned(), true)
}

pub(super) fn map_platform_error(error: PlatformError) -> CodeAgentError {
    match error {
        PlatformError::Worker(message) if message == "project not found" => {
            not_found("project was not found")
                .with_mutation_code(AgentMutationErrorCode::ProjectNotFound)
        }
        _ => internal("project registry is unavailable"),
    }
}

pub(super) fn git_repository_not_found() -> CodeAgentError {
    not_found("git repository was not found")
        .with_mutation_code(AgentMutationErrorCode::GitRepositoryUnavailable)
}

pub(super) fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}

pub(super) fn not_found(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::NotFound, message, None)
}

pub(super) fn conflict(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::Conflict, message, None)
}

pub(super) fn internal(message: &'static str) -> CodeAgentError {
    CodeAgentError::internal(message)
}
