//! CodeAgent 跨宿主序列化协议。

mod generated;

pub use generated::*;

use std::sync::LazyLock;

use jsonschema::Validator;
use serde_json::{Value, json};

static PROTOCOL_SCHEMA: LazyLock<Result<Value, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../schemas/code-agent-runtime.schema.json"
    ))
    .map_err(|error| error.to_string())
});
static PROVIDER_EVENT_VALIDATOR: LazyLock<Result<Validator, String>> =
    LazyLock::new(|| build_validator("AgentProviderEvent").map_err(|error| error.to_string()));
static TASK_SETTINGS_VALIDATOR: LazyLock<Result<Validator, String>> =
    LazyLock::new(|| build_validator("AgentTaskSettings").map_err(|error| error.to_string()));

/// 已通过版本化 Provider Event Schema 校验的原始事件。
#[derive(Clone, Debug, PartialEq)]
pub struct RawProviderEvent(Value);

impl RawProviderEvent {
    /// 返回 Provider 事件判别值。
    #[must_use]
    pub fn event_type(&self) -> &str {
        self.0["type"].as_str().unwrap_or_default()
    }

    /// 返回事件所属 Task ID。
    #[must_use]
    pub fn task_id(&self) -> &str {
        self.0["taskId"].as_str().unwrap_or_default()
    }

    /// 返回事件所属 Turn ID；Task 级事件没有该字段。
    #[must_use]
    pub fn turn_id(&self) -> Option<&str> {
        self.0["turnId"].as_str()
    }

    /// 返回事件所属 Item ID；Turn 或 Task 级事件没有该字段。
    #[must_use]
    pub fn item_id(&self) -> Option<&str> {
        self.0["itemId"].as_str()
    }

    /// 返回已校验事件的 JSON 表示。
    #[must_use]
    pub fn as_value(&self) -> &Value {
        &self.0
    }

    /// 消费并返回已校验事件的 JSON 表示。
    #[must_use]
    pub fn into_value(self) -> Value {
        self.0
    }

    /// 向已验证的字符串 Delta 追加内容。
    pub fn append_delta(&mut self, delta: &str) -> bool {
        let Some(current) = self.0["payload"]["delta"].as_str() else {
            return false;
        };
        self.0["payload"]["delta"] = Value::String(format!("{current}{delta}"));
        true
    }
}

/// Protocol JSON Schema 校验失败。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolValidationError {
    message: String,
}

impl ProtocolValidationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ProtocolValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProtocolValidationError {}

fn build_validator(name: &str) -> Result<Validator, ProtocolValidationError> {
    let schema = PROTOCOL_SCHEMA
        .as_ref()
        .map_err(|error| ProtocolValidationError::new(error.clone()))?;
    let definition_schema = json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": schema["$defs"].clone(),
        "$ref": format!("#/$defs/{name}")
    });
    jsonschema::draft202012::options()
        .should_validate_formats(true)
        .build(&definition_schema)
        .map_err(|error| ProtocolValidationError::new(error.to_string()))
}

fn validate_with(
    validator: &LazyLock<Result<Validator, String>>,
    value: &Value,
) -> Result<(), ProtocolValidationError> {
    validator
        .as_ref()
        .map_err(|error| ProtocolValidationError::new(error.clone()))?
        .validate(value)
        .map_err(|error| {
            ProtocolValidationError::new(format!(
                "protocol validation failed at {} against {}",
                error.instance_path(),
                error.schema_path()
            ))
        })
}

/// 校验并解析 Provider Event，禁止 Provider 携带 Runtime 传输字段。
pub fn parse_provider_event(value: Value) -> Result<RawProviderEvent, ProtocolValidationError> {
    validate_with(&PROVIDER_EVENT_VALIDATOR, &value)?;
    Ok(RawProviderEvent(value))
}

/// 校验并解析完整 Task 设置。
pub fn parse_agent_task_settings(
    value: Value,
) -> Result<AgentTaskSettings, ProtocolValidationError> {
    validate_with(&TASK_SETTINGS_VALIDATOR, &value)?;
    serde_json::from_value(value).map_err(|error| ProtocolValidationError::new(error.to_string()))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{CodeAgentError, parse_agent_task_settings, parse_provider_event};

    fn valid_settings_fixture() -> Value {
        json!({
            "approvalPolicy": "never",
            "approvalsReviewer": "user",
            "model": "gpt-5",
            "reasoningEffort": "high",
            "sandboxMode": "workspace-write"
        })
    }

    #[test]
    fn provider_event_should_round_trip_valid_fixture() -> Result<(), Box<dyn std::error::Error>> {
        let fixture = json!({
            "itemId": "item-1",
            "payload": { "delta": "hello" },
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "message.delta"
        });
        let event = parse_provider_event(fixture.clone())?;

        assert_eq!(event.into_value(), fixture);
        Ok(())
    }

    #[test]
    fn provider_event_should_reject_transport_fields() {
        let mut fixture = json!({
            "itemId": "item-1",
            "payload": { "delta": "hello" },
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "message.delta"
        });
        fixture["sequence"] = json!(1);

        assert!(parse_provider_event(fixture).is_err());
    }

    #[test]
    fn settings_should_reject_invalid_auto_review_combination() {
        let mut fixture = valid_settings_fixture();
        fixture["approvalsReviewer"] = json!("auto_review");

        assert!(parse_agent_task_settings(fixture).is_err());
    }

    #[test]
    fn error_should_reject_unknown_fields() {
        let fixture = json!({
            "code": "provider_failure",
            "message": "Provider failed",
            "nativeError": "forbidden"
        });

        assert!(serde_json::from_value::<CodeAgentError>(fixture).is_err());
    }
}
