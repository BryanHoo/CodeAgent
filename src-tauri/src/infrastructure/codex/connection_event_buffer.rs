use std::collections::{HashSet, VecDeque};

use serde::Deserialize;

use super::connection::ServerMessage;

pub(crate) const EVENT_RETENTION_EXCEEDED_METHOD: &str = "codeagent/eventRetentionExceeded";

const RECOVERABLE_DELTA_METHODS: &[&str] = &[
    "item/agentMessage/delta",
    "item/commandExecution/outputDelta",
    "item/plan/delta",
];

const IGNORED_REASONING_METHODS: &[&str] = &[
    "item/reasoning/textDelta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskScope<'a> {
    thread_id: &'a str,
}

pub(super) struct NotificationBuffer {
    capacity: usize,
    notifications: VecDeque<ServerMessage>,
    pending_resyncs: VecDeque<(String, ServerMessage)>,
    resync_task_ids: HashSet<String>,
}

impl NotificationBuffer {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            capacity,
            notifications: VecDeque::with_capacity(capacity),
            pending_resyncs: VecDeque::new(),
            resync_task_ids: HashSet::new(),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.pending_resyncs.is_empty() && self.notifications.is_empty()
    }

    pub(super) fn clear(&mut self) {
        self.notifications.clear();
        self.pending_resyncs.clear();
        self.resync_task_ids.clear();
    }

    pub(super) fn pop_front(&mut self) -> Option<ServerMessage> {
        if let Some((task_id, message)) = self.pending_resyncs.pop_front() {
            self.resync_task_ids.remove(&task_id);
            return Some(message);
        }
        self.notifications.pop_front()
    }

    pub(super) fn push(&mut self, message: ServerMessage) {
        // 推理内容不进入排队链路，避免无效事件占用内存和触发重同步。
        if is_ignored_reasoning_notification(&message) {
            return;
        }

        if self.notifications.len() < self.capacity {
            self.notifications.push_back(message);
            return;
        }

        if is_recoverable_delta(&message) {
            self.record_dropped_delta(message);
            return;
        }

        if let Some(index) = self.notifications.iter().position(is_recoverable_delta)
            && let Some(dropped) = self.notifications.remove(index)
        {
            self.record_dropped_delta(dropped);
        }

        // 全是事实流时允许短时超过软上限，避免审批或终态事件被静默删除。
        self.notifications.push_back(message);
    }

    fn record_dropped_delta(&mut self, mut message: ServerMessage) {
        let Ok(scope) = serde_json::from_str::<TaskScope<'_>>(message.params.get()) else {
            return;
        };
        let task_id = scope.thread_id.to_owned();
        if !self.resync_task_ids.insert(task_id.clone()) {
            return;
        }
        message.id = None;
        message.method = EVENT_RETENTION_EXCEEDED_METHOD.to_owned();
        self.pending_resyncs.push_back((task_id, message));
    }
}

fn is_recoverable_delta(message: &ServerMessage) -> bool {
    message.id.is_none() && RECOVERABLE_DELTA_METHODS.contains(&message.method.as_str())
}

fn is_ignored_reasoning_notification(message: &ServerMessage) -> bool {
    message.id.is_none() && IGNORED_REASONING_METHODS.contains(&message.method.as_str())
}

#[cfg(test)]
mod tests {
    use serde_json::value::to_raw_value;

    use super::*;

    #[test]
    fn reasoning_notifications_are_discarded_before_buffering() {
        let mut buffer = NotificationBuffer::new(1);

        for method in IGNORED_REASONING_METHODS {
            buffer.push(ServerMessage {
                id: None,
                method: (*method).to_owned(),
                params: to_raw_value(&serde_json::json!({
                    "threadId": "thread-a",
                    "turnId": "turn-a"
                }))
                .unwrap(),
            });
        }

        assert!(buffer.is_empty());
    }
}
