use std::sync::Arc;

use code_agent_core::{CodeAgentError, ProjectProviderPort};
use tokio_util::sync::CancellationToken;

use crate::AgentEventStream;

/// Runtime 内单个 Project 的 Provider 与事件流生命周期。
pub(crate) struct ProjectRuntimeContext {
    pub event_stream: Arc<AgentEventStream>,
    pub provider: Arc<dyn ProjectProviderPort>,
    shutdown: CancellationToken,
}

impl ProjectRuntimeContext {
    pub(crate) fn new(
        event_stream: Arc<AgentEventStream>,
        provider: Arc<dyn ProjectProviderPort>,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            event_stream,
            provider,
            shutdown,
        }
    }

    /// 先停止 Provider 转发，再冲刷并关闭事件流。
    pub(crate) async fn close(&self) -> Result<(), CodeAgentError> {
        self.shutdown.cancel();
        self.event_stream.close().await;
        Ok(())
    }
}
