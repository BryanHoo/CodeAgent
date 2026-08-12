use serde_json::{Map, Value};

pub const MAX_COMMAND_OUTPUT_BYTES: usize = 1_048_576;
pub const MAX_COMMAND_OUTPUT_LINES: usize = 10_000;
pub const MAX_REALTIME_DIFF_BYTES: usize = 512 * 1_024;
pub const MAX_REALTIME_FILE_CHANGES: usize = 100;
pub const MAX_STATUS_TEXT_CHARS: usize = 8_192;

pub const CODEX_MAPPED_NOTIFICATION_METHODS: &[&str] = &[
    "error",
    "guardianWarning",
    "hook/completed",
    "hook/started",
    "item/agentMessage/delta",
    "item/autoApprovalReview/completed",
    "item/autoApprovalReview/started",
    "item/commandExecution/outputDelta",
    "item/completed",
    "item/fileChange/patchUpdated",
    "item/mcpToolCall/progress",
    "item/plan/delta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/textDelta",
    "item/started",
    "model/rerouted",
    "model/safetyBuffering/updated",
    "model/verification",
    "thread/tokenUsage/updated",
    "turn/completed",
    "turn/diff/updated",
    "turn/plan/updated",
    "turn/started",
    "warning",
];

pub const CODEX_SPECIAL_NOTIFICATION_METHODS: &[&str] = &[
    "account/login/completed",
    "account/updated",
    "mcpServer/startupStatus/updated",
    "serverRequest/resolved",
    "thread/goal/cleared",
    "thread/goal/updated",
    "thread/started",
];

pub const CODEX_IGNORED_NOTIFICATION_METHODS: &[&str] = &[
    "account/rateLimits/updated",
    "app/list/updated",
    "command/exec/outputDelta",
    "configWarning",
    "deprecationNotice",
    "externalAgentConfig/import/completed",
    "externalAgentConfig/import/progress",
    "fs/changed",
    "fuzzyFileSearch/sessionCompleted",
    "fuzzyFileSearch/sessionUpdated",
    "item/commandExecution/terminalInteraction",
    "item/fileChange/outputDelta",
    "mcpServer/oauthLogin/completed",
    "process/exited",
    "process/outputDelta",
    "rawResponse/completed",
    "rawResponseItem/completed",
    "remoteControl/status/changed",
    "skills/changed",
    "thread/archived",
    "thread/closed",
    "thread/compacted",
    "thread/deleted",
    "thread/environment/connected",
    "thread/environment/disconnected",
    "thread/name/updated",
    "thread/realtime/closed",
    "thread/realtime/error",
    "thread/realtime/itemAdded",
    "thread/realtime/outputAudio/delta",
    "thread/realtime/sdp",
    "thread/realtime/started",
    "thread/realtime/transcript/delta",
    "thread/realtime/transcript/done",
    "thread/settings/updated",
    "thread/status/changed",
    "thread/unarchived",
    "turn/moderationMetadata",
    "windows/worldWritableWarning",
    "windowsSandbox/setupCompleted",
];

#[derive(Debug, thiserror::Error)]
#[error("Codex protocol mapping failed: {0}")]
pub struct CodexMappingError(pub(crate) String);

impl From<code_agent_protocol::ProtocolValidationError> for CodexMappingError {
    fn from(error: code_agent_protocol::ProtocolValidationError) -> Self {
        Self(error.to_string())
    }
}

pub(crate) fn record<'a>(
    value: &'a Value,
    context: &str,
) -> Result<&'a Map<String, Value>, CodexMappingError> {
    value
        .as_object()
        .ok_or_else(|| CodexMappingError(format!("{context} must be an object")))
}

pub(crate) fn string<'a>(value: &'a Value, context: &str) -> Result<&'a str, CodexMappingError> {
    value
        .as_str()
        .ok_or_else(|| CodexMappingError(format!("{context} must be a string")))
}

pub(crate) fn field_string<'a>(
    value: &'a Map<String, Value>,
    field: &str,
    context: &str,
) -> Result<&'a str, CodexMappingError> {
    string(
        value.get(field).unwrap_or(&Value::Null),
        &format!("{context} {field}"),
    )
}

pub(crate) fn optional_string(
    value: Option<&Value>,
    context: &str,
) -> Result<Option<String>, CodexMappingError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => string(value, context).map(|value| Some(value.to_string())),
    }
}

pub(crate) fn integer(value: &Value, context: &str) -> Result<i64, CodexMappingError> {
    value
        .as_i64()
        .ok_or_else(|| CodexMappingError(format!("{context} must be an integer")))
}

pub(crate) fn non_negative_integer(value: &Value, context: &str) -> Result<u64, CodexMappingError> {
    value
        .as_u64()
        .ok_or_else(|| CodexMappingError(format!("{context} must be a non-negative integer")))
}

pub(crate) fn boolean(value: &Value, context: &str) -> Result<bool, CodexMappingError> {
    value
        .as_bool()
        .ok_or_else(|| CodexMappingError(format!("{context} must be a boolean")))
}

pub(crate) fn bound_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

pub(crate) fn bound_utf8_prefix(value: &str, max_bytes: usize) -> (String, usize, bool) {
    let original_bytes = value.len();
    if original_bytes <= max_bytes {
        return (value.to_string(), original_bytes, false);
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_string(), original_bytes, true)
}

pub(crate) fn bound_command_output(value: &str) -> (String, bool) {
    let mut start = 0;
    let mut line_breaks = 0;
    for (index, byte) in value.bytes().enumerate().rev() {
        if byte == b'\n' {
            line_breaks += 1;
            if line_breaks == MAX_COMMAND_OUTPUT_LINES {
                start = index + 1;
                break;
            }
        }
    }
    let line_bounded = &value[start..];
    let byte_start = line_bounded.len().saturating_sub(MAX_COMMAND_OUTPUT_BYTES);
    let mut safe_start = byte_start;
    while safe_start < line_bounded.len() && !line_bounded.is_char_boundary(safe_start) {
        safe_start += 1;
    }
    (
        line_bounded[safe_start..].to_string(),
        start > 0 || safe_start > 0,
    )
}

pub(crate) fn map_item_status(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_str) {
        Some("inProgress") => "running",
        Some("pending") => "pending",
        Some("running") => "running",
        Some("failed") => "failed",
        Some("declined") => "declined",
        Some("interrupted") => "interrupted",
        _ => "completed",
    }
}

pub(crate) fn map_file_change_kind(value: &Value) -> Result<&'static str, CodexMappingError> {
    let kind = record(value, "Codex file change kind")?;
    match field_string(kind, "type", "Codex file change kind")? {
        "add" => Ok("create"),
        "delete" => Ok("delete"),
        "update" => Ok("update"),
        _ => Err(CodexMappingError(
            "Codex file change kind is invalid".to_string(),
        )),
    }
}
