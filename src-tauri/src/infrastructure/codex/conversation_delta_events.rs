use std::borrow::Cow;

use serde::Deserialize;

use crate::domain::runtime::{
    AgentDeltaEvent, AgentDeltaPayload, AgentDeltaType, ProviderKind, ReasoningDeltaField,
};

use super::{
    connection::{ConnectionError, ServerMessage},
    conversation::RUNTIME_SESSION_ID,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeltaNotification<'a> {
    thread_id: &'a str,
    turn_id: &'a str,
    item_id: &'a str,
    // JSON 转义内容无法直接借用；Cow 仅在换行等转义出现时分配解码缓冲区。
    #[serde(borrow)]
    delta: Cow<'a, str>,
    #[serde(default)]
    summary_index: Option<u64>,
}

pub(super) fn map_delta_message(
    message: &ServerMessage,
    sequence: u64,
    timestamp: &str,
    received_at_unix_ms: u64,
) -> Result<Option<AgentDeltaEvent>, ConnectionError> {
    let (event_type, field, requires_summary_index) = match message.method.as_str() {
        "item/agentMessage/delta" => (AgentDeltaType::Message, None, false),
        "item/reasoning/textDelta" => (
            AgentDeltaType::Reasoning,
            Some(ReasoningDeltaField::Content),
            false,
        ),
        "item/reasoning/summaryTextDelta" => (
            AgentDeltaType::Reasoning,
            Some(ReasoningDeltaField::Summary),
            true,
        ),
        "item/commandExecution/outputDelta" => (AgentDeltaType::CommandOutput, None, false),
        "item/plan/delta" => (AgentDeltaType::Plan, None, false),
        _ => return Ok(None),
    };
    let params: DeltaNotification<'_> = serde_json::from_str(message.params.get())?;
    if requires_summary_index && params.summary_index.is_none() {
        return Err(ConnectionError::InvalidMessage);
    }

    Ok(Some(AgentDeltaEvent {
        item_id: params.item_id.to_owned(),
        payload: AgentDeltaPayload {
            delta: params.delta.into_owned(),
            field,
            section_index: params.summary_index,
        },
        provider: ProviderKind::Codex,
        received_at_unix_ms,
        sequence,
        session_id: RUNTIME_SESSION_ID,
        task_id: params.thread_id.to_owned(),
        timestamp: timestamp.to_owned(),
        turn_id: params.turn_id.to_owned(),
        event_type,
        version: 2,
        source_event_count: 1,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, value::to_raw_value};

    use super::*;

    #[test]
    fn maps_raw_delta_directly_to_typed_event() {
        let message = ServerMessage {
            id: None,
            method: "item/reasoning/summaryTextDelta".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turnId": "turn-a",
                "itemId": "item-a",
                "delta": "结果",
                "summaryIndex": 2
            }))
            .unwrap(),
        };

        let event = map_delta_message(&message, 3, "2025-01-01T00:00:00Z", 1_735_689_600_123)
            .unwrap()
            .unwrap();

        assert_eq!(
            serde_json::to_value(event).unwrap(),
            json!({
                "itemId": "item-a",
                "payload": {"delta": "结果", "field": "summary", "sectionIndex": 2},
                "provider": "codex",
                "receivedAtUnixMs": 1_735_689_600_123_u64,
                "sequence": 3,
                "sessionId": "codeagent-runtime",
                "taskId": "thread-a",
                "timestamp": "2025-01-01T00:00:00Z",
                "turnId": "turn-a",
                "type": "reasoning.delta",
                "version": 2
            })
        );
    }

    #[test]
    fn maps_agent_message_delta_with_escaped_newlines() {
        let message = ServerMessage {
            id: None,
            method: "item/agentMessage/delta".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "turnId": "turn-a",
                "itemId": "item-a",
                "delta": "\n\n- 下一项"
            }))
            .unwrap(),
        };

        let event = map_delta_message(&message, 4, "2025-01-01T00:00:00Z", 1_735_689_600_456)
            .unwrap()
            .unwrap();

        assert_eq!(event.payload.delta, "\n\n- 下一项");
        assert_eq!(event.event_type, AgentDeltaType::Message);
    }
}
