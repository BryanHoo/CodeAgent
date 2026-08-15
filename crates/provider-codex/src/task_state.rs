use std::collections::{HashMap, HashSet};
use std::path::{Component, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, SecondsFormat};
use code_agent_core::CodeAgentError;
use code_agent_protocol::{ProviderEvent, ProviderEventKind};
use serde_json::{Value, json};

use crate::{PendingCodexRequest, RpcClientError};

pub(crate) const CODEX_PINNED_THREAD_SECTION_ID: &str = "01984de2-8f74-7c91-a3b2-5c5e937cf318";

#[derive(Default)]
pub(crate) struct TaskState {
    context_usage: Mutex<HashMap<String, Value>>,
    failed: Mutex<HashSet<String>>,
    plans: Mutex<HashMap<String, Value>>,
    running: Mutex<HashSet<String>>,
    unmaterialized: Mutex<HashMap<String, Value>>,
}

impl TaskState {
    pub(crate) fn mark_running(&self, task_id: &str) {
        if let Ok(mut running) = self.running.lock() {
            running.insert(task_id.to_owned());
        }
    }

    pub(crate) fn sync_running(&self, task_id: &str, running: bool) {
        if let Ok(mut tasks) = self.running.lock() {
            if running {
                tasks.insert(task_id.to_owned());
            } else {
                tasks.remove(task_id);
            }
        }
    }

    pub(crate) fn is_running(&self, task_id: &str) -> bool {
        self.running
            .lock()
            .is_ok_and(|running| running.contains(task_id))
    }

    pub(crate) fn remember_unmaterialized(&self, task: Value) -> Result<(), CodeAgentError> {
        let task_id = task["id"]
            .as_str()
            .ok_or_else(|| CodeAgentError::internal("new task id is invalid"))?;
        self.unmaterialized
            .lock()
            .map_err(|_| CodeAgentError::internal("task state is poisoned"))?
            .insert(task_id.to_string(), task);
        Ok(())
    }

    pub(crate) fn materialized(&self, task_id: &str) {
        if let Ok(mut tasks) = self.unmaterialized.lock() {
            tasks.remove(task_id);
        }
    }

    pub(crate) fn clear_task(&self, task_id: &str) {
        if let Ok(mut cache) = self.context_usage.lock() {
            cache.remove(task_id);
        }
        if let Ok(mut cache) = self.plans.lock() {
            cache.remove(task_id);
        }
        if let Ok(mut tasks) = self.failed.lock() {
            tasks.remove(task_id);
        }
        if let Ok(mut tasks) = self.running.lock() {
            tasks.remove(task_id);
        }
        self.materialized(task_id);
    }

    pub(crate) fn unmaterialized(&self, task_id: &str) -> Option<Value> {
        self.unmaterialized
            .lock()
            .ok()
            .and_then(|tasks| tasks.get(task_id).cloned())
    }

    pub(crate) fn pending_tasks(&self) -> Vec<Value> {
        let mut tasks = self
            .unmaterialized
            .lock()
            .map(|tasks| tasks.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        tasks.sort_by(|left, right| right["updatedAt"].as_str().cmp(&left["updatedAt"].as_str()));
        tasks
    }

    pub(crate) fn observe(&self, event: &ProviderEvent) {
        let task_id = event.task_id();
        match event.kind() {
            ProviderEventKind::UsageUpdated => {
                if let Some(usage) = event.usage()
                    && let Ok(mut cache) = self.context_usage.lock()
                {
                    cache.insert(task_id.to_string(), usage.clone());
                }
            }
            ProviderEventKind::PlanUpdated => {
                if let Some(plan) = event.plan()
                    && let Ok(mut cache) = self.plans.lock()
                {
                    cache.insert(task_id.to_string(), plan.clone());
                }
            }
            ProviderEventKind::TurnStarted => {
                if let Ok(mut running) = self.running.lock() {
                    running.insert(task_id.to_string());
                }
                if let Ok(mut failed) = self.failed.lock() {
                    failed.remove(task_id);
                }
            }
            ProviderEventKind::TurnCompleted => {
                if let Ok(mut running) = self.running.lock() {
                    running.remove(task_id);
                }
                if let Ok(mut failed) = self.failed.lock() {
                    if event
                        .turn()
                        .and_then(|turn| turn.get("status"))
                        .and_then(Value::as_str)
                        == Some("failed")
                    {
                        failed.insert(task_id.to_string());
                    } else {
                        failed.remove(task_id);
                    }
                }
            }
            _ => {}
        }
    }

    pub(crate) fn enrich_snapshot(
        &self,
        task_id: &str,
        snapshot: &mut Value,
        native_status: Option<&Value>,
        turns: &[Value],
        pending: &HashMap<String, PendingCodexRequest>,
    ) {
        snapshot["contextUsage"] = self
            .context_usage
            .lock()
            .ok()
            .and_then(|cache| cache.get(task_id).cloned())
            .unwrap_or(Value::Null);
        snapshot["plan"] = self
            .plans
            .lock()
            .ok()
            .and_then(|cache| cache.get(task_id).cloned())
            .unwrap_or(Value::Null);
        snapshot["pendingRequests"] = Value::Array(
            pending
                .values()
                .filter(|entry| entry.request["taskId"].as_str() == Some(task_id))
                .map(|entry| entry.request.clone())
                .collect(),
        );
        let running = turns.iter().any(|turn| turn["status"] == "running")
            || self
                .running
                .lock()
                .is_ok_and(|tasks| tasks.contains(task_id))
            || native_status
                .and_then(|status| status.get("type"))
                .and_then(Value::as_str)
                == Some("active");
        let failed = self
            .failed
            .lock()
            .is_ok_and(|tasks| tasks.contains(task_id))
            || native_status
                .and_then(|status| status.get("type"))
                .and_then(Value::as_str)
                == Some("systemError");
        snapshot["status"] = Value::String(
            if running {
                "running"
            } else if failed {
                "failed"
            } else {
                "idle"
            }
            .to_string(),
        );
    }
}

pub(crate) fn map_task(thread: &Value, project_id: &str) -> Result<Value, CodeAgentError> {
    let id = thread
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CodeAgentError::internal("Codex thread id is invalid"))?;
    let timestamp = thread
        .get("updatedAt")
        .and_then(Value::as_i64)
        .and_then(|seconds| DateTime::from_timestamp(seconds, 0))
        .ok_or_else(|| CodeAgentError::internal("Codex thread updatedAt is invalid"))?;
    let title = thread
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            thread
                .get("preview")
                .and_then(Value::as_str)
                .and_then(|value| value.lines().next())
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("新聊天");
    let pinned =
        match thread.get("section") {
            None | Some(Value::Null) => false,
            Some(Value::Object(section)) => {
                let id = section.get("id").and_then(Value::as_str).ok_or_else(|| {
                    CodeAgentError::internal("Codex thread section id is invalid")
                })?;
                section.get("name").and_then(Value::as_str).ok_or_else(|| {
                    CodeAgentError::internal("Codex thread section name is invalid")
                })?;
                id == CODEX_PINNED_THREAD_SECTION_ID
            }
            Some(_) => return Err(CodeAgentError::internal("Codex thread section is invalid")),
        };
    Ok(json!({
        "id": id,
        "pinned": pinned,
        "projectId": project_id,
        "title": title,
        "updatedAt": timestamp.to_rfc3339_opts(SecondsFormat::Millis, true)
    }))
}

pub(crate) fn empty_snapshot(task: Value) -> Value {
    let mut snapshot = task;
    snapshot["contextUsage"] = Value::Null;
    snapshot["pendingRequests"] = json!([]);
    snapshot["plan"] = Value::Null;
    snapshot["status"] = Value::String("idle".to_string());
    snapshot["turns"] = json!([]);
    snapshot
}

pub(crate) fn is_thread_not_loaded(error: &RpcClientError) -> bool {
    matches!(error, RpcClientError::Response { code: -32600, message, .. } if message.starts_with("thread not loaded:"))
}

pub(crate) fn is_thread_not_materialized(error: &RpcClientError) -> bool {
    matches!(error, RpcClientError::Response { code: -32600, message, .. } if message.contains("is not materialized yet; includeTurns is unavailable before first user message"))
}

pub(crate) fn is_background_terminal_thread_missing(error: &RpcClientError) -> bool {
    matches!(error, RpcClientError::Response { code: -32600, message, .. } if message.starts_with("thread not found:"))
}

pub(crate) async fn same_canonical_path(left: &str, right: &str) -> bool {
    canonical_path_identity(left).await == canonical_path_identity(right).await
}

async fn canonical_path_identity(path: &str) -> PathBuf {
    let normalized = match tokio::fs::canonicalize(path).await {
        Ok(path) => normalize_path(path),
        Err(_) => normalize_path(PathBuf::from(path)),
    };
    #[cfg(windows)]
    {
        return PathBuf::from(normalized.to_string_lossy().to_lowercase());
    }
    #[cfg(not(windows))]
    {
        normalized
    }
}

fn normalize_path(path: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    if normalized.is_absolute() {
        normalized
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&normalized))
            .unwrap_or(normalized)
    }
}
