use serde_json::Value;

use super::{ProviderEvent, ProviderEventData, ProviderEventKind, ReasoningDeltaField};

impl ProviderEvent {
    /// 返回事件判别类型。
    #[must_use]
    pub const fn kind(&self) -> ProviderEventKind {
        match self.data {
            ProviderEventData::TurnStarted { .. } => ProviderEventKind::TurnStarted,
            ProviderEventData::MessageDelta { .. } => ProviderEventKind::MessageDelta,
            ProviderEventData::ReasoningDelta { .. } => ProviderEventKind::ReasoningDelta,
            ProviderEventData::CommandOutputDelta { .. } => ProviderEventKind::CommandOutputDelta,
            ProviderEventData::PlanDelta { .. } => ProviderEventKind::PlanDelta,
            ProviderEventData::ToolProgress { .. } => ProviderEventKind::ToolProgress,
            ProviderEventData::FileChangeUpdated { .. } => ProviderEventKind::FileChangeUpdated,
            ProviderEventData::TurnDiffUpdated { .. } => ProviderEventKind::TurnDiffUpdated,
            ProviderEventData::ItemStarted { .. } => ProviderEventKind::ItemStarted,
            ProviderEventData::ItemCompleted { .. } => ProviderEventKind::ItemCompleted,
            ProviderEventData::TurnCompleted { .. } => ProviderEventKind::TurnCompleted,
            ProviderEventData::UsageUpdated { .. } => ProviderEventKind::UsageUpdated,
            ProviderEventData::PlanUpdated { .. } => ProviderEventKind::PlanUpdated,
            ProviderEventData::ProviderError { .. } => ProviderEventKind::ProviderError,
            ProviderEventData::TaskNotice { .. } => ProviderEventKind::TaskNotice,
            ProviderEventData::McpServerStatusUpdated { .. } => {
                ProviderEventKind::McpServerStatusUpdated
            }
            ProviderEventData::PendingRequestCreated { .. } => {
                ProviderEventKind::PendingRequestCreated
            }
            ProviderEventData::PendingRequestResolved { .. } => {
                ProviderEventKind::PendingRequestResolved
            }
            ProviderEventData::PendingRequestExpired { .. } => {
                ProviderEventKind::PendingRequestExpired
            }
        }
    }

    /// 返回外部协议事件判别值。
    #[must_use]
    pub const fn event_type(&self) -> &'static str {
        self.kind().as_str()
    }

    /// 返回事件所属 Task ID。
    #[must_use]
    pub fn task_id(&self) -> &str {
        &self.task_id
    }

    /// 返回事件所属 Turn ID。
    #[must_use]
    pub fn turn_id(&self) -> Option<&str> {
        match &self.data {
            ProviderEventData::TaskNotice { .. }
            | ProviderEventData::McpServerStatusUpdated { .. } => None,
            ProviderEventData::TurnStarted { turn_id, .. }
            | ProviderEventData::MessageDelta { turn_id, .. }
            | ProviderEventData::ReasoningDelta { turn_id, .. }
            | ProviderEventData::CommandOutputDelta { turn_id, .. }
            | ProviderEventData::PlanDelta { turn_id, .. }
            | ProviderEventData::ToolProgress { turn_id, .. }
            | ProviderEventData::FileChangeUpdated { turn_id, .. }
            | ProviderEventData::TurnDiffUpdated { turn_id, .. }
            | ProviderEventData::ItemStarted { turn_id, .. }
            | ProviderEventData::ItemCompleted { turn_id, .. }
            | ProviderEventData::TurnCompleted { turn_id, .. }
            | ProviderEventData::UsageUpdated { turn_id, .. }
            | ProviderEventData::PlanUpdated { turn_id, .. }
            | ProviderEventData::ProviderError { turn_id, .. }
            | ProviderEventData::PendingRequestCreated { turn_id, .. }
            | ProviderEventData::PendingRequestResolved { turn_id, .. }
            | ProviderEventData::PendingRequestExpired { turn_id, .. } => Some(turn_id),
        }
    }

    /// 返回事件所属 Item ID。
    #[must_use]
    pub fn item_id(&self) -> Option<&str> {
        match &self.data {
            ProviderEventData::MessageDelta { item_id, .. }
            | ProviderEventData::ReasoningDelta { item_id, .. }
            | ProviderEventData::CommandOutputDelta { item_id, .. }
            | ProviderEventData::PlanDelta { item_id, .. }
            | ProviderEventData::ToolProgress { item_id, .. }
            | ProviderEventData::FileChangeUpdated { item_id, .. }
            | ProviderEventData::ItemStarted { item_id, .. }
            | ProviderEventData::ItemCompleted { item_id, .. }
            | ProviderEventData::PendingRequestCreated { item_id, .. }
            | ProviderEventData::PendingRequestResolved { item_id, .. }
            | ProviderEventData::PendingRequestExpired { item_id, .. } => Some(item_id),
            _ => None,
        }
    }

    /// 返回追加型事件的 Delta。
    #[must_use]
    pub fn delta(&self) -> Option<&str> {
        match &self.data {
            ProviderEventData::MessageDelta { payload, .. }
            | ProviderEventData::CommandOutputDelta { payload, .. }
            | ProviderEventData::PlanDelta { payload, .. } => Some(&payload.delta),
            ProviderEventData::ReasoningDelta { payload, .. } => Some(&payload.delta),
            _ => None,
        }
    }

    /// 向追加型事件原地写入 Delta。
    pub fn append_delta(&mut self, delta: &str) -> bool {
        let target = match &mut self.data {
            ProviderEventData::MessageDelta { payload, .. }
            | ProviderEventData::CommandOutputDelta { payload, .. }
            | ProviderEventData::PlanDelta { payload, .. } => &mut payload.delta,
            ProviderEventData::ReasoningDelta { payload, .. } => &mut payload.delta,
            _ => return false,
        };
        target.push_str(delta);
        true
    }

    /// 返回 Reasoning Delta 字段。
    #[must_use]
    pub fn reasoning_field(&self) -> Option<ReasoningDeltaField> {
        match &self.data {
            ProviderEventData::ReasoningDelta { payload, .. } => Some(payload.field),
            _ => None,
        }
    }

    /// 返回 Reasoning Summary 分段索引。
    #[must_use]
    pub fn section_index(&self) -> Option<u64> {
        match &self.data {
            ProviderEventData::ReasoningDelta { payload, .. } => payload.section_index,
            _ => None,
        }
    }

    /// 返回 Item 事件中的统一 Item。
    #[must_use]
    pub fn item(&self) -> Option<&Value> {
        match &self.data {
            ProviderEventData::ItemStarted { payload, .. }
            | ProviderEventData::ItemCompleted { payload, .. } => payload.get("item"),
            _ => None,
        }
    }

    /// 返回 Turn 事件中的统一 Turn。
    #[must_use]
    pub fn turn(&self) -> Option<&Value> {
        match &self.data {
            ProviderEventData::TurnStarted { payload, .. }
            | ProviderEventData::TurnCompleted { payload, .. } => payload.get("turn"),
            _ => None,
        }
    }

    /// 返回 Usage 事件中的统一上下文用量。
    #[must_use]
    pub fn usage(&self) -> Option<&Value> {
        match &self.data {
            ProviderEventData::UsageUpdated { payload, .. } => payload.get("usage"),
            _ => None,
        }
    }

    /// 返回 Plan 事件中的统一计划。
    #[must_use]
    pub fn plan(&self) -> Option<&Value> {
        match &self.data {
            ProviderEventData::PlanUpdated { payload, .. } => payload.get("plan"),
            _ => None,
        }
    }

    /// 返回 MCP 状态事件载荷。
    #[must_use]
    pub fn mcp_status(&self) -> Option<&Value> {
        match &self.data {
            ProviderEventData::McpServerStatusUpdated { payload } => Some(payload),
            _ => None,
        }
    }

    /// 返回 Pending Request 生命周期事件中的请求。
    #[must_use]
    pub fn pending_request(&self) -> Option<&Value> {
        match &self.data {
            ProviderEventData::PendingRequestCreated { payload, .. }
            | ProviderEventData::PendingRequestResolved { payload, .. }
            | ProviderEventData::PendingRequestExpired { payload, .. } => payload.get("request"),
            _ => None,
        }
    }

    /// 返回 Provider Error 消息。
    #[must_use]
    pub fn provider_error_message(&self) -> Option<&str> {
        match &self.data {
            ProviderEventData::ProviderError { payload, .. } => {
                payload.get("message").and_then(Value::as_str)
            }
            _ => None,
        }
    }

    /// 返回 Provider Error 是否会重试。
    #[must_use]
    pub fn provider_error_will_retry(&self) -> Option<bool> {
        match &self.data {
            ProviderEventData::ProviderError { payload, .. } => {
                payload.get("willRetry").and_then(Value::as_bool)
            }
            _ => None,
        }
    }

    /// 借用事件并转换为低频边界适配使用的 JSON 对象。
    pub fn to_value(&self) -> Result<Value, serde_json::Error> {
        serde_json::to_value(self)
    }
}
