use serde::{Deserialize, Serialize};
use serde_json::Value;

mod access;

/// Provider 事件的稳定判别类型。
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ProviderEventKind {
    TurnStarted,
    MessageDelta,
    ReasoningDelta,
    CommandOutputDelta,
    PlanDelta,
    ToolProgress,
    FileChangeUpdated,
    TurnDiffUpdated,
    ItemStarted,
    ItemCompleted,
    TurnCompleted,
    UsageUpdated,
    PlanUpdated,
    ProviderError,
    TaskNotice,
    McpServerStatusUpdated,
    PendingRequestCreated,
    PendingRequestResolved,
    PendingRequestExpired,
}

impl ProviderEventKind {
    /// 返回外部协议使用的事件判别值。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TurnStarted => "turn.started",
            Self::MessageDelta => "message.delta",
            Self::ReasoningDelta => "reasoning.delta",
            Self::CommandOutputDelta => "command.output_delta",
            Self::PlanDelta => "plan.delta",
            Self::ToolProgress => "tool.progress",
            Self::FileChangeUpdated => "file_change.updated",
            Self::TurnDiffUpdated => "turn.diff_updated",
            Self::ItemStarted => "item.started",
            Self::ItemCompleted => "item.completed",
            Self::TurnCompleted => "turn.completed",
            Self::UsageUpdated => "usage.updated",
            Self::PlanUpdated => "plan.updated",
            Self::ProviderError => "provider.error",
            Self::TaskNotice => "task.notice",
            Self::McpServerStatusUpdated => "mcp_server.status_updated",
            Self::PendingRequestCreated => "pending_request.created",
            Self::PendingRequestResolved => "pending_request.resolved",
            Self::PendingRequestExpired => "pending_request.expired",
        }
    }

    /// 返回事件是否参与 Runtime trailing-window 合并。
    #[must_use]
    pub const fn is_coalesced(self) -> bool {
        matches!(
            self,
            Self::MessageDelta
                | Self::ReasoningDelta
                | Self::CommandOutputDelta
                | Self::PlanDelta
                | Self::ToolProgress
                | Self::FileChangeUpdated
                | Self::TurnDiffUpdated
        )
    }

    /// 返回事件合并时是否追加 Delta。
    #[must_use]
    pub const fn appends_delta(self) -> bool {
        matches!(
            self,
            Self::MessageDelta | Self::ReasoningDelta | Self::CommandOutputDelta | Self::PlanDelta
        )
    }
}

/// Reasoning Delta 所更新的字段。
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningDeltaField {
    Content,
    Summary,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaPayload {
    delta: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningDeltaPayload {
    delta: String,
    field: ReasoningDeltaField,
    #[serde(skip_serializing_if = "Option::is_none")]
    section_index: Option<u64>,
}

/// 已通过 Provider Event Schema 校验的内部强类型事件。
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type")]
enum ProviderEventData {
    #[serde(rename = "turn.started")]
    TurnStarted {
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "message.delta")]
    MessageDelta {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: DeltaPayload,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "reasoning.delta")]
    ReasoningDelta {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: ReasoningDeltaPayload,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "command.output_delta")]
    CommandOutputDelta {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: DeltaPayload,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "plan.delta")]
    PlanDelta {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: DeltaPayload,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "tool.progress")]
    ToolProgress {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "file_change.updated")]
    FileChangeUpdated {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "turn.diff_updated")]
    TurnDiffUpdated {
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "item.started")]
    ItemStarted {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "item.completed")]
    ItemCompleted {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "turn.completed")]
    TurnCompleted {
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "usage.updated")]
    UsageUpdated {
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "plan.updated")]
    PlanUpdated {
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "provider.error")]
    ProviderError {
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "task.notice")]
    TaskNotice { payload: Value },
    #[serde(rename = "mcp_server.status_updated")]
    McpServerStatusUpdated { payload: Value },
    #[serde(rename = "pending_request.created")]
    PendingRequestCreated {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "pending_request.resolved")]
    PendingRequestResolved {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
    #[serde(rename = "pending_request.expired")]
    PendingRequestExpired {
        #[serde(rename = "itemId")]
        item_id: String,
        payload: Value,
        #[serde(rename = "turnId")]
        turn_id: String,
    },
}

/// Provider 内部与 Core Port 传递的强类型领域事件。
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProviderEvent {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(flatten)]
    data: ProviderEventData,
}

impl ProviderEvent {
    /// 直接构造 Message Delta，避免高频路径生成中间 JSON。
    pub fn message_delta(
        task_id: impl Into<String>,
        turn_id: impl Into<String>,
        item_id: impl Into<String>,
        delta: impl Into<String>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            data: ProviderEventData::MessageDelta {
                item_id: item_id.into(),
                payload: DeltaPayload {
                    delta: delta.into(),
                },
                turn_id: turn_id.into(),
            },
        }
    }

    /// 直接构造 Command Output Delta。
    pub fn command_output_delta(
        task_id: impl Into<String>,
        turn_id: impl Into<String>,
        item_id: impl Into<String>,
        delta: impl Into<String>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            data: ProviderEventData::CommandOutputDelta {
                item_id: item_id.into(),
                payload: DeltaPayload {
                    delta: delta.into(),
                },
                turn_id: turn_id.into(),
            },
        }
    }

    /// 直接构造 Plan Delta。
    pub fn plan_delta(
        task_id: impl Into<String>,
        turn_id: impl Into<String>,
        item_id: impl Into<String>,
        delta: impl Into<String>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            data: ProviderEventData::PlanDelta {
                item_id: item_id.into(),
                payload: DeltaPayload {
                    delta: delta.into(),
                },
                turn_id: turn_id.into(),
            },
        }
    }

    /// 直接构造 Reasoning Delta。
    pub fn reasoning_delta(
        task_id: impl Into<String>,
        turn_id: impl Into<String>,
        item_id: impl Into<String>,
        delta: impl Into<String>,
        field: ReasoningDeltaField,
        section_index: Option<u64>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            data: ProviderEventData::ReasoningDelta {
                item_id: item_id.into(),
                payload: ReasoningDeltaPayload {
                    delta: delta.into(),
                    field,
                    section_index,
                },
                turn_id: turn_id.into(),
            },
        }
    }
}
