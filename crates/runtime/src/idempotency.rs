use std::{
    collections::HashMap,
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use serde_json::Value;
use tokio::sync::{Mutex, watch};

type OperationResult = Result<Value, CodeAgentError>;
type RegistryKey = (Arc<str>, Arc<str>);

#[derive(Debug)]
enum EntryState {
    Completed { expires_at: Instant, value: Value },
    InFlight(watch::Sender<Option<OperationResult>>),
}

#[derive(Debug)]
struct Entry {
    payload: Value,
    state: EntryState,
}

/// 成功结果和进行中请求共享同一容量预算的幂等注册表。
#[derive(Debug)]
pub struct IdempotencyRegistry {
    capacity: usize,
    state: Mutex<RegistryState>,
    ttl: Duration,
}

#[derive(Debug)]
struct RegistryState {
    closed: bool,
    entries: HashMap<RegistryKey, Entry>,
}

impl IdempotencyRegistry {
    /// 创建至少保留一个 key 的注册表。
    #[must_use]
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            capacity: capacity.max(1),
            state: Mutex::new(RegistryState {
                closed: false,
                entries: HashMap::new(),
            }),
            ttl: ttl.max(Duration::from_millis(1)),
        }
    }

    /// 复用相同 operation/key/payload 的进行中或成功结果。
    pub async fn execute<F, Fut>(
        &self,
        operation: &str,
        key: &str,
        payload: &Value,
        execute: F,
    ) -> OperationResult
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = OperationResult>,
    {
        let registry_key = (Arc::from(operation), Arc::from(key));
        let mut receiver = None;
        let sender = {
            let mut state = self.state.lock().await;
            if state.closed {
                return Err(CodeAgentError::new(
                    CodeAgentErrorCode::ShuttingDown,
                    "idempotency registry is closed",
                    None,
                ));
            }
            let now = Instant::now();
            // 只淘汰成功结果，进行中请求必须保留到完成并通知全部等待者。
            state.entries.retain(|_, entry| {
                !matches!(
                    entry.state,
                    EntryState::Completed { expires_at, .. } if expires_at <= now
                )
            });
            if let Some(entry) = state.entries.get(&registry_key) {
                if entry.payload != *payload {
                    return Err(CodeAgentError::new(
                        CodeAgentErrorCode::Conflict,
                        "idempotency key payload conflict",
                        None,
                    ));
                }
                match &entry.state {
                    EntryState::Completed { value, .. } => return Ok(value.clone()),
                    EntryState::InFlight(sender) => receiver = Some(sender.subscribe()),
                }
                None
            } else {
                if state.entries.len() >= self.capacity {
                    return Err(CodeAgentError::new(
                        CodeAgentErrorCode::CapacityExceeded,
                        "idempotency capacity exceeded",
                        None,
                    ));
                }
                let (sender, _) = watch::channel(None);
                state.entries.insert(
                    registry_key.clone(),
                    Entry {
                        payload: payload.clone(),
                        state: EntryState::InFlight(sender.clone()),
                    },
                );
                Some(sender)
            }
        };

        if let Some(mut receiver) = receiver {
            while receiver.changed().await.is_ok() {
                if let Some(result) = receiver.borrow().clone() {
                    return result;
                }
            }
            return Err(CodeAgentError::internal(
                "idempotent operation ended without a result",
            ));
        }

        let result = execute().await;
        let mut state = self.state.lock().await;
        let sender = sender.map(|sender| {
            if let Ok(value) = &result
                && !state.closed
            {
                state.entries.insert(
                    registry_key.clone(),
                    Entry {
                        payload: payload.clone(),
                        state: EntryState::Completed {
                            expires_at: Instant::now() + self.ttl,
                            value: value.clone(),
                        },
                    },
                );
                sender
            } else {
                state.entries.remove(&registry_key);
                sender
            }
        });
        if let Some(sender) = sender {
            sender.send_replace(Some(result.clone()));
        }
        result
    }

    /// 停止接收并清空成功结果；进行中请求仍会收到自身执行结果。
    pub async fn close(&self) {
        let mut state = self.state.lock().await;
        state.closed = true;
        state
            .entries
            .retain(|_, entry| matches!(entry.state, EntryState::InFlight(_)));
    }
}
