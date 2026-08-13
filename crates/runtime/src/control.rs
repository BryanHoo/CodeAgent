use std::{
    collections::HashMap,
    ops::Deref,
    sync::{Arc, Mutex, MutexGuard},
};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode, PortRequestContext};
/// 同时活动操作的有界注册表。
#[derive(Debug)]
pub struct OperationRegistry {
    capacity: usize,
    // `Drop` 无法等待异步锁；该锁只包围有界 Map 的常数时间操作，不跨越任何 I/O 或 await。
    state: Mutex<OperationRegistryState>,
}

#[derive(Debug)]
struct OperationRegistryState {
    accepting: bool,
    operations: HashMap<Arc<str>, PortRequestContext>,
}

/// 在生命周期结束时自动释放注册表容量的操作句柄。
#[derive(Debug)]
pub struct OperationGuard<'registry> {
    context: PortRequestContext,
    registry: &'registry OperationRegistry,
    request_id: Arc<str>,
}

impl Deref for OperationGuard<'_> {
    type Target = PortRequestContext;

    fn deref(&self) -> &Self::Target {
        &self.context
    }
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        self.registry
            .lock_state()
            .operations
            .remove(self.request_id.as_ref());
    }
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

    /// 注册新操作并返回自动释放容量的共享取消上下文。
    pub async fn begin(&self, request_id: &str) -> Result<OperationGuard<'_>, CodeAgentError> {
        let mut state = self.lock_state();
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
        let request_id = Arc::from(request_id);
        state
            .operations
            .insert(Arc::clone(&request_id), context.clone());
        Ok(OperationGuard {
            context,
            registry: self,
            request_id,
        })
    }

    /// 协作取消活动操作；不存在时幂等返回 `false`。
    pub async fn cancel(&self, request_id: &str) -> bool {
        let state = self.lock_state();
        let Some(context) = state.operations.get(request_id) else {
            return false;
        };
        context.cancel();
        true
    }

    /// 原子停止接收新操作，并取消全部活动操作。
    pub async fn close(&self) {
        let mut state = self.lock_state();
        state.accepting = false;
        for context in state.operations.values() {
            context.cancel();
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, OperationRegistryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
