use std::sync::Arc;

pub use code_agent_protocol::{
    CodeAgentErrorCode, CodeAgentErrorMutationCode as AgentMutationErrorCode,
};
use serde_json::{Value, json};
use thiserror::Error;

/// 跨领域端口传播的稳定错误。
#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("{message}")]
pub struct CodeAgentError {
    code: CodeAgentErrorCode,
    correlation_id: Option<Arc<str>>,
    message: Arc<str>,
    mutation_code: Option<AgentMutationErrorCode>,
}

impl CodeAgentError {
    /// 创建带稳定错误码和可选追踪 ID 的领域错误。
    #[must_use]
    pub fn new(
        code: CodeAgentErrorCode,
        message: impl Into<Arc<str>>,
        correlation_id: Option<Arc<str>>,
    ) -> Self {
        Self {
            code,
            correlation_id,
            message: message.into(),
            mutation_code: None,
        }
    }

    /// 为 Delivery 边界附加稳定的领域错误码。
    #[must_use]
    pub fn with_mutation_code(mut self, mutation_code: AgentMutationErrorCode) -> Self {
        self.mutation_code = Some(mutation_code);
        self
    }

    /// 创建不暴露底层实现细节的内部错误。
    #[must_use]
    pub fn internal(message: impl Into<Arc<str>>) -> Self {
        Self::new(CodeAgentErrorCode::Internal, message, None)
    }

    /// 返回稳定错误码。
    #[must_use]
    pub fn code(&self) -> CodeAgentErrorCode {
        self.code
    }

    /// 返回用户可读错误信息。
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// 返回供客户端恢复和反馈使用的领域错误码。
    #[must_use]
    pub fn mutation_code(&self) -> Option<AgentMutationErrorCode> {
        self.mutation_code
    }

    /// 返回可选的内部追踪 ID。
    #[must_use]
    pub fn correlation_id(&self) -> Option<&str> {
        self.correlation_id.as_deref()
    }

    /// 转换为 Protocol JSON 形状，供 Delivery 边界序列化。
    #[must_use]
    pub fn to_protocol_value(&self) -> Value {
        let mut value = json!({
            "code": self.code.to_string(),
            "message": self.message.as_ref(),
        });
        if let Some(correlation_id) = &self.correlation_id {
            value["correlationId"] = json!(correlation_id.as_ref());
        }
        if let Some(mutation_code) = self.mutation_code {
            value["mutationCode"] = json!(mutation_code);
        }
        value
    }
}
