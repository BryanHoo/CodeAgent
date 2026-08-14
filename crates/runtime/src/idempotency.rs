use std::{
    collections::HashMap,
    fmt::Write,
    future::Future,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::sync::watch;

type OperationResult = Result<Value, CodeAgentError>;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct RegistryKey {
    key: Arc<str>,
    scope: Box<[Arc<str>]>,
}

impl RegistryKey {
    fn new(scope: &[&str], key: &str) -> Self {
        Self {
            key: Arc::from(key),
            scope: scope.iter().map(|part| Arc::from(*part)).collect(),
        }
    }
}

#[derive(Debug)]
struct CompletedEntry {
    expires_at: Instant,
    payload: Value,
    value: Value,
}

#[derive(Debug)]
struct InFlightEntry {
    payload: Value,
    sender: watch::Sender<Option<OperationResult>>,
}

/// 分别限制成功结果和进行中请求容量的幂等注册表。
#[derive(Debug)]
pub struct IdempotencyRegistry {
    capacity: usize,
    state: Mutex<RegistryState>,
    ttl: Duration,
}

#[derive(Debug)]
struct RegistryState {
    closed: bool,
    completed_entries: HashMap<RegistryKey, CompletedEntry>,
    in_flight_entries: HashMap<RegistryKey, InFlightEntry>,
}

struct InFlightGuard<'registry> {
    registry: &'registry IdempotencyRegistry,
    registry_key: RegistryKey,
    sender: Option<watch::Sender<Option<OperationResult>>>,
}

impl Drop for InFlightGuard<'_> {
    fn drop(&mut self) {
        let Some(sender) = self.sender.take() else {
            return;
        };
        self.registry
            .lock_state()
            .in_flight_entries
            .remove(&self.registry_key);
        sender.send_replace(Some(Err(CodeAgentError::new(
            CodeAgentErrorCode::Cancelled,
            "idempotent operation was cancelled",
            None,
        ))));
    }
}

impl IdempotencyRegistry {
    /// 创建至少保留一个 key 的注册表。
    #[must_use]
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            capacity: capacity.max(1),
            state: Mutex::new(RegistryState {
                closed: false,
                completed_entries: HashMap::new(),
                in_flight_entries: HashMap::new(),
            }),
            ttl: ttl.max(Duration::from_millis(1)),
        }
    }

    /// 复用相同 scope/key/payload 的进行中或成功结果。
    pub async fn execute<T, F, Fut>(
        &self,
        scope: &[&str],
        key: &str,
        payload: &Value,
        execute: F,
    ) -> Result<T, CodeAgentError>
    where
        T: DeserializeOwned + Serialize,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, CodeAgentError>>,
    {
        let registry_key = RegistryKey::new(scope, key);
        let mut receiver = None;
        let sender = {
            let mut state = self.lock_state();
            if state.closed {
                return Err(CodeAgentError::new(
                    CodeAgentErrorCode::ShuttingDown,
                    "idempotency registry is closed",
                    None,
                ));
            }
            let now = Instant::now();
            // 只淘汰成功结果，进行中请求必须保留到完成并通知全部等待者。
            state
                .completed_entries
                .retain(|_, entry| entry.expires_at > now);
            if let Some(entry) = state.in_flight_entries.get(&registry_key) {
                if entry.payload != *payload {
                    return Err(CodeAgentError::new(
                        CodeAgentErrorCode::Conflict,
                        "idempotency key payload conflict",
                        None,
                    ));
                }
                receiver = Some(entry.sender.subscribe());
                None
            } else if let Some(entry) = state.completed_entries.get(&registry_key) {
                if entry.payload != *payload {
                    return Err(CodeAgentError::new(
                        CodeAgentErrorCode::Conflict,
                        "idempotency key payload conflict",
                        None,
                    ));
                }
                return deserialize_result(entry.value.clone());
            } else {
                if state.in_flight_entries.len() >= self.capacity {
                    return Err(CodeAgentError::new(
                        CodeAgentErrorCode::CapacityExceeded,
                        "idempotency capacity exceeded",
                        None,
                    ));
                }
                let (sender, _) = watch::channel(None);
                state.in_flight_entries.insert(
                    registry_key.clone(),
                    InFlightEntry {
                        payload: payload.clone(),
                        sender: sender.clone(),
                    },
                );
                Some(sender)
            }
        };

        if let Some(mut receiver) = receiver {
            while receiver.changed().await.is_ok() {
                if let Some(result) = receiver.borrow().clone() {
                    return result.and_then(deserialize_result);
                }
            }
            return Err(CodeAgentError::internal(
                "idempotent operation ended without a result",
            ));
        }

        let mut guard = InFlightGuard {
            registry: self,
            registry_key: registry_key.clone(),
            sender,
        };
        let result = execute().await;
        let cached_result = match &result {
            Ok(value) => serde_json::to_value(value)
                .map_err(|error| CodeAgentError::internal(error.to_string())),
            Err(error) => Err(error.clone()),
        };
        let mut state = self.lock_state();
        let sender = guard.sender.take().map(|sender| {
            if let Ok(value) = &cached_result
                && !state.closed
            {
                state.in_flight_entries.remove(&registry_key);
                if state.completed_entries.len() >= self.capacity
                    && let Some(expired_key) = state
                        .completed_entries
                        .iter()
                        .min_by_key(|(_, entry)| entry.expires_at)
                        .map(|(key, _)| key.clone())
                {
                    state.completed_entries.remove(&expired_key);
                }
                state.completed_entries.insert(
                    registry_key.clone(),
                    CompletedEntry {
                        expires_at: Instant::now() + self.ttl,
                        payload: payload.clone(),
                        value: value.clone(),
                    },
                );
                sender
            } else {
                state.in_flight_entries.remove(&registry_key);
                sender
            }
        });
        if let Some(sender) = sender {
            sender.send_replace(Some(cached_result));
        }
        result
    }

    /// 停止接收并清空成功结果；进行中请求仍会收到自身执行结果。
    pub async fn close(&self) {
        let mut state = self.lock_state();
        state.closed = true;
        state.completed_entries.clear();
    }

    fn lock_state(&self) -> MutexGuard<'_, RegistryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn deserialize_result<T: DeserializeOwned>(value: Value) -> Result<T, CodeAgentError> {
    serde_json::from_value(value).map_err(|error| CodeAgentError::internal(error.to_string()))
}

/// 使用业务幂等键生成无分隔符碰撞的活动操作身份。
pub(crate) fn operation_identity(scope: &[&str], idempotency_key: &str) -> String {
    let capacity =
        scope.iter().map(|part| part.len() + 8).sum::<usize>() + idempotency_key.len() + 8;
    let mut identity = String::with_capacity(capacity);
    for part in scope
        .iter()
        .copied()
        .chain(std::iter::once(idempotency_key))
    {
        let _ = write!(identity, "{}:{part}", part.len());
    }
    identity
}
