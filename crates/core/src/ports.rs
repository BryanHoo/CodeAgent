use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_protocol::{AgentCapabilities, ProjectId, TaskId};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::CodeAgentError;

/// 单次领域操作的身份与协作取消上下文。
#[derive(Clone, Debug)]
pub struct PortRequestContext {
    cancellation: CancellationToken,
    request_id: Arc<str>,
}

impl PortRequestContext {
    /// 创建请求上下文。
    #[must_use]
    pub fn new(request_id: impl Into<Arc<str>>) -> Self {
        Self {
            cancellation: CancellationToken::new(),
            request_id: request_id.into(),
        }
    }

    /// 返回请求 ID。
    #[must_use]
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    /// 通知所有共享上下文的操作协作取消。
    pub fn cancel(&self) {
        self.cancellation.cancel();
    }

    /// 返回请求是否已取消。
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    /// 等待取消通知。
    pub async fn cancelled(&self) {
        self.cancellation.cancelled().await;
    }
}

/// Project 与设置持久化端口。
#[async_trait]
pub trait RepositoryPort: Send + Sync {
    /// 读取已注册 Project；不存在时返回 `None`。
    async fn read_project(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError>;
}

/// Provider 领域能力端口。
#[async_trait]
pub trait ProviderPort: Send + Sync {
    /// 读取当前 Provider 能力。
    async fn capabilities(
        &self,
        context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError>;
}

/// Git 宿主能力端口。
#[async_trait]
pub trait GitPort: Send + Sync {
    /// 读取 Project Git 状态。
    async fn status(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError>;
}

/// Project 文件能力端口。
#[async_trait]
pub trait FilePort: Send + Sync {
    /// 读取受 Project 范围约束的文件字节。
    async fn read(
        &self,
        project_id: &ProjectId,
        path: &str,
        context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError>;
}

/// Task 附件能力端口。
#[async_trait]
pub trait AttachmentPort: Send + Sync {
    /// 读取已授权附件字节。
    async fn read(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
        context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError>;
}

/// 可替换时钟端口。
pub trait ClockPort: Send + Sync {
    /// 返回当前 UTC 时间。
    fn now(&self) -> DateTime<Utc>;
}

/// 应用更新能力端口。
#[async_trait]
pub trait UpdatePort: Send + Sync {
    /// 返回当前产品版本。
    async fn current_version(&self, context: &PortRequestContext)
    -> Result<String, CodeAgentError>;
}
