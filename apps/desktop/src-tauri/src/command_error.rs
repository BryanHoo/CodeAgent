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
        let _ = message.into();
        Self::new("invalid_input", "请求参数无效", false)
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        let _ = message.into();
        Self::new("invalid_request", "请求无效", false)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        let _ = message.into();
        Self::new("not_found", "请求的资源不存在", false)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        let _ = message.into();
        Self::new("internal", "操作失败，请使用追踪 ID 定位问题", false)
    }

    fn new(code: &str, message: &str, retryable: bool) -> Self {
        Self {
            code: code.to_owned(),
            correlation_id: Uuid::new_v4().to_string(),
            message: message.to_owned(),
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
            message: user_message(error.code()).to_owned(),
            retryable,
        }
    }
}

fn user_message(code: code_agent_core::CodeAgentErrorCode) -> &'static str {
    use code_agent_core::CodeAgentErrorCode;
    match code {
        CodeAgentErrorCode::Cancelled => "操作已取消",
        CodeAgentErrorCode::CapacityExceeded => "请求内容过大或系统繁忙，请稍后重试",
        CodeAgentErrorCode::Conflict => "当前状态已变化，请刷新后重试",
        CodeAgentErrorCode::Internal => "操作失败，请使用追踪 ID 定位问题",
        CodeAgentErrorCode::InvalidInput => "请求参数无效",
        CodeAgentErrorCode::NotFound => "请求的资源不存在",
        CodeAgentErrorCode::ProviderFailure => "Provider 暂时不可用，请稍后重试",
        CodeAgentErrorCode::ShuttingDown => "应用正在退出",
        CodeAgentErrorCode::Timeout => "操作超时，请稍后重试",
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
    use uuid::Uuid;

    use super::CommandError;

    #[test]
    fn preserves_or_generates_correlation_ids() {
        let existing = CommandError::from(CodeAgentError::new(
            CodeAgentErrorCode::Internal,
            "/secret/path failed",
            Some(Arc::from("trace-existing")),
        ));
        assert_eq!(existing.correlation_id, "trace-existing");
        assert!(!existing.message.contains("/secret/path"));

        let generated = CommandError::invalid_input("bad field");
        assert!(Uuid::parse_str(&generated.correlation_id).is_ok());
    }
}
