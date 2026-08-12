use code_agent_protocol::RawProviderEvent;
use serde_json::{Value, json};

use super::CodexProjectProvider;

impl CodexProjectProvider {
    pub(crate) async fn publish(&self, event: RawProviderEvent) {
        if event.event_type() == "turn.completed"
            && let Some(turn_id) = event.turn_id()
        {
            for terminal in self.pending.expire_turn(event.task_id(), turn_id) {
                if let Ok(terminal) = code_agent_protocol::parse_provider_event(terminal) {
                    self.broadcast(terminal);
                }
            }
        }
        self.task_state.observe(&event);
        self.broadcast(event);
    }

    fn broadcast(&self, event: RawProviderEvent) {
        let ephemeral = self
            .ephemeral
            .lock()
            .map(|tasks| tasks.contains(event.task_id()))
            .unwrap_or(false);
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.retain(|subscriber| {
                if ephemeral && !subscriber.include_ephemeral {
                    return !subscriber.sender.is_closed();
                }
                if subscriber.sender.capacity() <= 1 {
                    // 最后一个槽位用于明确通知上层重新读取快照。
                    if let Ok(overflow) = code_agent_protocol::parse_provider_event(json!({
                        "payload": {
                            "code": "internal_error",
                            "message": "Provider event subscription overflowed",
                            "willRetry": false
                        },
                        "taskId": event.task_id(),
                        "turnId": event.turn_id().unwrap_or("provider"),
                        "type": "provider.error"
                    })) {
                        let _ = subscriber.sender.try_send(overflow);
                    }
                    return false;
                }
                subscriber.sender.try_send(event.clone()).is_ok()
            });
        }
    }

    pub(super) fn publish_value(&self, value: Value) {
        if let Ok(event) = code_agent_protocol::parse_provider_event(value) {
            self.task_state.observe(&event);
            self.broadcast(event);
        }
    }

    pub(crate) async fn publish_failure(&self) {
        let tasks = self
            .tasks
            .lock()
            .map(|tasks| tasks.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for task_id in tasks {
            if let Ok(event) = code_agent_protocol::parse_provider_event(json!({
                "payload": { "code": "connection_failed", "message": "Codex App Server exited", "willRetry": false },
                "taskId": task_id, "turnId": "provider", "type": "provider.error"
            })) {
                self.publish(event).await;
            }
        }
    }

    pub(crate) async fn receive_mcp_status(&self, params: &Value) {
        if let Ok(event) = self.mcp.update(params) {
            self.publish(event).await;
        }
    }
}
