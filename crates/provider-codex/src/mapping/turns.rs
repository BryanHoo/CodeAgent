use code_agent_protocol::{ValueDefinition, parse_protocol_value};
use serde_json::{Value, json};

use super::common::{
    CodexMappingError, field_string, non_negative_integer, optional_string, record,
};
use super::items::map_codex_item;

/// 映射 Codex Token Usage，只公开统一协议需要的当前上下文占用。
pub fn map_context_usage(value: &Value) -> Result<Value, CodexMappingError> {
    let usage = record(value, "Codex token usage")?;
    let last = record(
        usage.get("last").unwrap_or(&Value::Null),
        "Codex last token usage",
    )?;
    let used_tokens = non_negative_integer(
        last.get("totalTokens").unwrap_or(&Value::Null),
        "Codex token usage inputTokens/totalTokens",
    )?;
    let context_window = match usage.get("modelContextWindow") {
        None | Some(Value::Null) => Value::Null,
        Some(value) => {
            let parsed = non_negative_integer(value, "Codex context window")?;
            if parsed == 0 {
                return Err(CodexMappingError(
                    "Codex context usage is invalid".to_string(),
                ));
            }
            json!(parsed)
        }
    };
    Ok(json!({ "contextWindow": context_window, "usedTokens": used_tokens }))
}

fn timestamp_seconds(value: Option<&Value>, context: &str) -> Result<Value, CodexMappingError> {
    match value {
        None | Some(Value::Null) => Ok(Value::Null),
        Some(value) => {
            let seconds = value
                .as_i64()
                .ok_or_else(|| CodexMappingError(format!("{context} must be a Unix timestamp")))?;
            let timestamp = chrono::DateTime::from_timestamp(seconds, 0)
                .ok_or_else(|| CodexMappingError(format!("{context} is out of range")))?;
            Ok(Value::String(
                timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            ))
        }
    }
}

fn turn_status(value: Option<&Value>) -> Result<&'static str, CodexMappingError> {
    match value.and_then(Value::as_str) {
        Some("inProgress") => Ok("running"),
        Some("completed") => Ok("completed"),
        Some("failed") => Ok("failed"),
        Some("interrupted") => Ok("interrupted"),
        _ => Err(CodexMappingError(
            "Codex turn status is invalid".to_string(),
        )),
    }
}

/// 将 Codex 原生 Turn 投影并通过公共 `AgentTurn` Schema 校验。
pub fn map_codex_turn(value: &Value) -> Result<Value, CodexMappingError> {
    let turn = record(value, "Codex turn")?;
    let items = turn
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| CodexMappingError("Codex turn items must be an array".to_string()))?
        .iter()
        .map(map_codex_item)
        .collect::<Result<Vec<_>, _>>()?;
    let error = match turn.get("error") {
        None | Some(Value::Null) => Value::Null,
        Some(value) => {
            let error = record(value, "Codex turn error")?;
            Value::String(field_string(error, "message", "Codex turn error")?.to_string())
        }
    };
    let mapped = json!({
        "completedAt": timestamp_seconds(turn.get("completedAt"), "Codex turn completedAt")?,
        "error": error,
        "id": field_string(turn, "id", "Codex turn")?,
        "items": items,
        "startedAt": timestamp_seconds(turn.get("startedAt"), "Codex turn startedAt")?,
        "status": turn_status(turn.get("status"))?
    });
    parse_protocol_value(ValueDefinition::AgentTurn, mapped).map_err(Into::into)
}

pub(crate) fn optional_nullable_string(
    value: Option<&Value>,
    context: &str,
) -> Result<Value, CodexMappingError> {
    Ok(optional_string(value, context)?.map_or(Value::Null, Value::String))
}
