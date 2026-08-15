//! CodeAgent 跨宿主序列化协议。

// 生成代码中的正则常量由 typify 产出，统一豁免 unwrap 提示。
#[allow(clippy::unwrap_used)]
mod generated;
mod provider_event;

pub use generated::*;
pub use provider_event::{ProviderEvent, ProviderEventKind, ReasoningDeltaField};

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
pub fn parse_provider_event(value: Value) -> Result<ProviderEvent, ProtocolValidationError> {
    validate_with(&PROVIDER_EVENT_VALIDATOR, &value)?;
    serde_json::from_value(value).map_err(|error| ProtocolValidationError::new(error.to_string()))
}

/// typify 无法无损生成的复杂联合定义；运行时以内嵌 JSON Schema 校验后按 JSON 使用。
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ValueDefinition {
    AgentTaskSnapshot,
    AgentTaskSnapshotResponse,
    AgentTurn,
    EventStreamMessage,
    PendingRequest,
    ResolvePendingRequestRequest,
    ReviewAgentTaskRequest,
    StartAgentTurnRequest,
    SteerAgentTurnRequest,
}

impl ValueDefinition {
    const ALL: [Self; 9] = [
        Self::AgentTaskSnapshot,
        Self::AgentTaskSnapshotResponse,
        Self::AgentTurn,
        Self::EventStreamMessage,
        Self::PendingRequest,
        Self::ResolvePendingRequestRequest,
        Self::ReviewAgentTaskRequest,
        Self::StartAgentTurnRequest,
        Self::SteerAgentTurnRequest,
    ];

    /// 返回 Schema `$defs` 中的定义名。
    #[must_use]
    pub fn definition_name(self) -> &'static str {
        match self {
            Self::AgentTaskSnapshot => "AgentTaskSnapshot",
            Self::AgentTaskSnapshotResponse => "AgentTaskSnapshotResponse",
            Self::AgentTurn => "AgentTurn",
            Self::EventStreamMessage => "EventStreamMessage",
            Self::PendingRequest => "PendingRequest",
            Self::ResolvePendingRequestRequest => "ResolvePendingRequestRequest",
            Self::ReviewAgentTaskRequest => "ReviewAgentTaskRequest",
            Self::StartAgentTurnRequest => "StartAgentTurnRequest",
            Self::SteerAgentTurnRequest => "SteerAgentTurnRequest",
        }
    }
}

static VALUE_VALIDATORS: LazyLock<Result<Vec<(ValueDefinition, Validator)>, String>> =
    LazyLock::new(|| {
        ValueDefinition::ALL
            .into_iter()
            .map(|definition| {
                build_validator(definition.definition_name())
                    .map(|validator| (definition, validator))
                    .map_err(|error| error.to_string())
            })
            .collect()
    });

/// 校验并返回复杂联合定义的 JSON 值。
pub fn parse_protocol_value(
    definition: ValueDefinition,
    value: Value,
) -> Result<Value, ProtocolValidationError> {
    let validators = VALUE_VALIDATORS
        .as_ref()
        .map_err(|error| ProtocolValidationError::new(error.clone()))?;
    let validator = validators
        .iter()
        .find_map(|(candidate, validator)| (*candidate == definition).then_some(validator))
        .ok_or_else(|| ProtocolValidationError::new("unknown protocol definition"))?;
    validator.validate(&value).map_err(|error| {
        ProtocolValidationError::new(format!(
            "protocol validation failed for {} at {} against {}",
            definition.definition_name(),
            error.instance_path(),
            error.schema_path()
        ))
    })?;
    Ok(value)
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

    use super::{
        CodeAgentError, ProviderEvent, ProviderEventKind, ValueDefinition,
        parse_agent_task_settings, parse_protocol_value, parse_provider_event,
    };

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

        assert_eq!(event.into_value()?, fixture);
        Ok(())
    }

    #[test]
    fn provider_event_should_construct_and_append_delta_without_json() {
        let mut event = ProviderEvent::message_delta("task-1", "turn-1", "item-1", "hel");

        assert_eq!(event.kind(), ProviderEventKind::MessageDelta);
        assert!(event.append_delta("lo"));
        assert_eq!(event.delta(), Some("hello"));
        assert_eq!(
            serde_json::to_value(event).expect("serialize provider event"),
            json!({
                "itemId": "item-1",
                "payload": { "delta": "hello" },
                "taskId": "task-1",
                "turnId": "turn-1",
                "type": "message.delta"
            })
        );
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

    fn valid_turn_fixture() -> Value {
        json!({
            "completedAt": null,
            "error": null,
            "id": "turn-1",
            "items": [],
            "startedAt": "2026-08-12T00:00:00.000Z",
            "status": "running"
        })
    }

    #[test]
    fn value_definitions_should_round_trip_valid_fixtures() -> Result<(), Box<dyn std::error::Error>>
    {
        let turn = parse_protocol_value(ValueDefinition::AgentTurn, valid_turn_fixture())?;
        assert_eq!(turn["id"], "turn-1");

        let ready = parse_protocol_value(
            ValueDefinition::EventStreamMessage,
            json!({
                "latestSequence": 7,
                "sessionId": "session-1",
                "type": "connection.ready",
                "version": 2
            }),
        )?;
        assert_eq!(ready["type"], "connection.ready");

        let pending = parse_protocol_value(
            ValueDefinition::PendingRequest,
            json!({
                "availableDecisions": ["allow", "deny"],
                "command": "ls",
                "createdAt": "2026-08-12T00:00:00.000Z",
                "cwd": "/tmp",
                "expiresAt": null,
                "itemId": "item-1",
                "networkAccess": null,
                "projectId": "project-1",
                "reason": null,
                "requestId": "request-1",
                "status": "pending",
                "taskId": "task-1",
                "turnId": "turn-1",
                "type": "command_approval"
            }),
        )?;
        assert_eq!(pending["type"], "command_approval");

        let resolve = parse_protocol_value(
            ValueDefinition::ResolvePendingRequestRequest,
            json!({
                "itemId": "item-1",
                "projectId": "project-1",
                "resolution": { "decision": "allow" },
                "taskId": "task-1",
                "turnId": "turn-1",
                "type": "command_approval"
            }),
        )?;
        assert_eq!(resolve["resolution"]["decision"], "allow");

        let start_turn = parse_protocol_value(
            ValueDefinition::StartAgentTurnRequest,
            json!({
                "input": {
                    "attachments": [],
                    "skills": [],
                    "text": "hello",
                    "type": "prompt"
                },
                "options": {
                    "approvalPolicy": "never",
                    "approvalsReviewer": "user",
                    "model": "gpt-5",
                    "reasoningEffort": "high",
                    "sandboxMode": "workspace-write"
                }
            }),
        )?;
        assert_eq!(start_turn["input"]["text"], "hello");

        let snapshot = parse_protocol_value(
            ValueDefinition::AgentTaskSnapshotResponse,
            json!({
                "checkpoint": { "sequence": 3, "sessionId": "session-1" },
                "snapshot": {
                    "contextUsage": null,
                    "id": "task-1",
                    "pendingRequests": [],
                    "pinned": false,
                    "plan": null,
                    "projectId": "project-1",
                    "settings": {
                        "approvalPolicy": "never",
                        "approvalsReviewer": "user",
                        "model": "gpt-5",
                        "reasoningEffort": "high",
                        "sandboxMode": "workspace-write"
                    },
                    "status": "idle",
                    "title": "Task",
                    "turns": [valid_turn_fixture()],
                    "updatedAt": "2026-08-12T00:00:00.000Z"
                }
            }),
        )?;
        assert_eq!(snapshot["snapshot"]["id"], "task-1");
        Ok(())
    }

    #[test]
    fn value_definitions_should_reject_invalid_payloads() {
        let mut broken_turn = valid_turn_fixture();
        broken_turn["status"] = json!("paused");
        assert!(parse_protocol_value(ValueDefinition::AgentTurn, broken_turn).is_err());

        assert!(
            parse_protocol_value(
                ValueDefinition::EventStreamMessage,
                json!({ "type": "connection.ready" }),
            )
            .is_err()
        );

        assert!(
            parse_protocol_value(
                ValueDefinition::PendingRequest,
                json!({ "type": "command_approval" }),
            )
            .is_err()
        );

        assert!(
            parse_protocol_value(
                ValueDefinition::StartAgentTurnRequest,
                json!({ "input": { "type": "prompt" } }),
            )
            .is_err()
        );
    }
}
