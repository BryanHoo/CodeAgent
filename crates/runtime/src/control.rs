use std::{collections::HashMap, sync::Arc};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode, PortRequestContext};
use tokio::sync::Mutex;

/// 同时活动操作的有界注册表。
#[derive(Debug)]
pub struct OperationRegistry {
    capacity: usize,
    state: Mutex<OperationRegistryState>,
}

#[derive(Debug)]
struct OperationRegistryState {
    accepting: bool,
    operations: HashMap<Arc<str>, PortRequestContext>,
}

impl OperationRegistry {
    /// 创建至少允许一个活动操作的注册表。
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            state: Mutex::new(OperationRegistryState {
                accepting: true,
                operations: HashMap::new(),
            }),
        }
    }

    /// 注册新操作并返回共享取消上下文。
    pub async fn begin(&self, request_id: &str) -> Result<PortRequestContext, CodeAgentError> {
        let mut state = self.state.lock().await;
        if !state.accepting {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::ShuttingDown,
                "runtime is shutting down",
                None,
            ));
        }
        if state.operations.contains_key(request_id) {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::Conflict,
                "request ID is already active",
                None,
            ));
        }
        if state.operations.len() >= self.capacity {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::CapacityExceeded,
                "operation capacity exceeded",
                None,
            ));
        }

        let context = PortRequestContext::new(request_id);
        state
            .operations
            .insert(Arc::from(request_id), context.clone());
        Ok(context)
    }

    /// 协作取消活动操作；不存在时幂等返回 `false`。
    pub async fn cancel(&self, request_id: &str) -> bool {
        let state = self.state.lock().await;
        let Some(context) = state.operations.get(request_id) else {
            return false;
        };
        context.cancel();
        true
    }

    /// 从活动注册表释放已完成操作。
    pub async fn finish(&self, request_id: &str) {
        self.state.lock().await.operations.remove(request_id);
    }

    /// 原子停止接收新操作，并取消全部活动操作。
    pub async fn close(&self) {
        let mut state = self.state.lock().await;
        state.accepting = false;
        for context in state.operations.values() {
            context.cancel();
        }
    }
}
