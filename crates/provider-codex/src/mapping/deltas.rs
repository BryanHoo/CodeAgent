use code_agent_protocol::{ProviderEvent, ReasoningDeltaField};
use serde_json::{Map, Value};

use super::common::{CodexMappingError, field_string, non_negative_integer};

/// 高频 Delta 已逐字段验证，直接进入强类型事件，避免构造和遍历 JSON。
pub(super) fn map_delta(
    method: &str,
    params: &Map<String, Value>,
    task_id: &str,
    turn_id: &str,
) -> Result<Option<ProviderEvent>, CodexMappingError> {
    let event = match method {
        "item/agentMessage/delta" => ProviderEvent::message_delta(
            task_id,
            turn_id,
            field_string(params, "itemId", "Codex agent message delta")?,
            field_string(params, "delta", "Codex agent message delta")?,
        ),
        "item/commandExecution/outputDelta" => ProviderEvent::command_output_delta(
            task_id,
            turn_id,
            field_string(params, "itemId", "Codex command output delta")?,
            field_string(params, "delta", "Codex command output delta")?,
        ),
        "item/plan/delta" => ProviderEvent::plan_delta(
            task_id,
            turn_id,
            field_string(params, "itemId", "Codex plan delta")?,
            field_string(params, "delta", "Codex plan delta")?,
        ),
        "item/reasoning/textDelta" => reasoning_delta(
            params,
            task_id,
            turn_id,
            ReasoningDeltaField::Content,
            false,
        )?,
        "item/reasoning/summaryPartAdded" => {
            reasoning_delta(params, task_id, turn_id, ReasoningDeltaField::Summary, true)?
        }
        "item/reasoning/summaryTextDelta" => reasoning_delta(
            params,
            task_id,
            turn_id,
            ReasoningDeltaField::Summary,
            false,
        )?,
        _ => return Ok(None),
    };
    Ok(Some(event))
}

fn reasoning_delta(
    params: &Map<String, Value>,
    task_id: &str,
    turn_id: &str,
    field: ReasoningDeltaField,
    empty_delta: bool,
) -> Result<ProviderEvent, CodexMappingError> {
    let delta = if empty_delta {
        ""
    } else {
        field_string(params, "delta", "Codex reasoning delta")?
    };
    let section_index = (field == ReasoningDeltaField::Summary)
        .then(|| {
            non_negative_integer(
                params.get("summaryIndex").unwrap_or(&Value::Null),
                "Codex summary index",
            )
        })
        .transpose()?;
    Ok(ProviderEvent::reasoning_delta(
        task_id,
        turn_id,
        field_string(params, "itemId", "Codex reasoning delta")?,
        delta,
        field,
        section_index,
    ))
}
