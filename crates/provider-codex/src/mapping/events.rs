use code_agent_protocol::{ProviderEvent, parse_provider_event};
use serde_json::{Map, Value, json};

use super::common::{
    CODEX_MAPPED_NOTIFICATION_METHODS, CodexMappingError, MAX_REALTIME_DIFF_BYTES,
    MAX_REALTIME_FILE_CHANGES, MAX_STATUS_TEXT_CHARS, boolean, bound_chars, bound_utf8_prefix,
    field_string, map_file_change_kind, optional_string, record,
};
use super::deltas::map_delta;
use super::items::{ensure_started_item_running, map_codex_item};
use super::plans::map_plan;
use super::turns::{map_codex_turn, map_context_usage};

fn validated(value: Value) -> Result<Option<ProviderEvent>, CodexMappingError> {
    parse_provider_event(value).map(Some).map_err(Into::into)
}

fn turn_id<'a>(params: &'a Map<String, Value>, method: &str) -> Result<&'a str, CodexMappingError> {
    field_string(params, "turnId", &format!("Codex {method}"))
}

fn map_realtime_changes(value: &Value) -> Result<Value, CodexMappingError> {
    let changes = value.as_array().ok_or_else(|| {
        CodexMappingError("Codex file change update must be an array".to_string())
    })?;
    let mut mapped = Vec::with_capacity(changes.len().min(MAX_REALTIME_FILE_CHANGES));
    let mut original_byte_length = 0_usize;
    let mut remaining_bytes = MAX_REALTIME_DIFF_BYTES;
    let mut truncated = changes.len() > MAX_REALTIME_FILE_CHANGES;
    for (index, change) in changes.iter().enumerate() {
        let change = record(change, "Codex file change update")?;
        let diff = field_string(change, "diff", "Codex file change update")?;
        original_byte_length = original_byte_length.saturating_add(diff.len());
        if index >= MAX_REALTIME_FILE_CHANGES {
            continue;
        }
        let (diff, _, diff_truncated) = bound_utf8_prefix(diff, remaining_bytes);
        remaining_bytes = remaining_bytes.saturating_sub(diff.len());
        truncated |= diff_truncated;
        mapped.push(json!({
            "diff": diff,
            "kind": map_file_change_kind(change.get("kind").unwrap_or(&Value::Null))?,
            "path": field_string(change, "path", "Codex file change update")?
        }));
    }
    Ok(json!({
        "changes": mapped,
        "originalByteLength": original_byte_length,
        "truncated": truncated
    }))
}

fn provider_error_info(value: Option<&Value>) -> (Option<&'static str>, Option<i64>) {
    let Some(value) = value else {
        return (None, None);
    };
    if let Some(code) = value.as_str() {
        return (
            Some(match code {
                "badRequest" => "bad_request",
                "contextWindowExceeded" => "context_window_exceeded",
                "cyberPolicy" => "policy_blocked",
                "internalServerError" => "internal_error",
                "sandboxError" => "sandbox_error",
                "serverOverloaded" => "server_overloaded",
                "sessionBudgetExceeded" => "session_budget_exceeded",
                "unauthorized" => "unauthorized",
                "usageLimitExceeded" => "usage_limit_exceeded",
                _ => "other",
            }),
            None,
        );
    }
    let Some(info) = value.as_object() else {
        return (Some("other"), None);
    };
    for key in [
        "httpConnectionFailed",
        "responseStreamConnectionFailed",
        "responseStreamDisconnected",
        "responseTooManyFailedAttempts",
    ] {
        if let Some(connection) = info.get(key).and_then(Value::as_object) {
            return (
                Some("connection_failed"),
                connection.get("httpStatusCode").and_then(Value::as_i64),
            );
        }
    }
    (Some("other"), None)
}

fn hook_item(params: &Map<String, Value>, started: bool) -> Result<Value, CodexMappingError> {
    let run = record(params.get("run").unwrap_or(&Value::Null), "Codex hook run")?;
    let status = if started {
        "running"
    } else {
        match field_string(run, "status", "Codex hook run")? {
            "running" => "running",
            "completed" => "completed",
            "failed" | "blocked" => "failed",
            "stopped" => "interrupted",
            _ => {
                return Err(CodexMappingError(
                    "Codex hook status is invalid".to_string(),
                ));
            }
        }
    };
    let mut item = json!({
        "eventName": field_string(run, "eventName", "Codex hook run")?,
        "id": format!("hook-{}", field_string(run, "id", "Codex hook run")?),
        "kind": "hook",
        "status": status,
        "type": "runtime_status"
    });
    if let Some(detail) = optional_string(run.get("statusMessage"), "Codex hook statusMessage")? {
        item["detail"] = Value::String(bound_chars(&detail, MAX_STATUS_TEXT_CHARS));
    }
    if let Some(duration) = run.get("durationMs").and_then(Value::as_u64) {
        item["durationMs"] = json!(duration);
    }
    Ok(item)
}

fn approval_review_action(value: &Value) -> Result<Value, CodexMappingError> {
    let action = record(value, "Codex automatic approval review action")?;
    match field_string(action, "type", "Codex automatic approval review action")? {
        "command" => Ok(json!({
            "detail": field_string(action, "command", "Codex automatic approval review command")?,
            "type": "command"
        })),
        "execve" => {
            let argv = action
                .get("argv")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    CodexMappingError("Codex automatic approval review argv is invalid".to_string())
                })?
                .iter()
                .map(|value| value.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| {
                    CodexMappingError("Codex automatic approval review argv is invalid".to_string())
                })?;
            let program =
                field_string(action, "program", "Codex automatic approval review program")?;
            Ok(
                json!({ "detail": std::iter::once(program.to_string()).chain(argv).collect::<Vec<_>>().join(" "), "type": "command" }),
            )
        }
        "applyPatch" => {
            let files = action
                .get("files")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    CodexMappingError(
                        "Codex automatic approval review files are invalid".to_string(),
                    )
                })?
                .iter()
                .map(|value| value.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| {
                    CodexMappingError(
                        "Codex automatic approval review files are invalid".to_string(),
                    )
                })?;
            Ok(json!({ "detail": files.join("\n"), "type": "file_change" }))
        }
        "networkAccess" => Ok(json!({
            "detail": field_string(action, "target", "Codex automatic approval review network target")?,
            "type": "network_access"
        })),
        "mcpToolCall" => {
            let detail = optional_string(
                action.get("toolTitle"),
                "Codex automatic approval review tool title",
            )?
            .unwrap_or_else(|| {
                format!(
                    "{}/{}",
                    action
                        .get("server")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    action
                        .get("toolName")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                )
            });
            if detail == "/" {
                return Err(CodexMappingError(
                    "Codex automatic approval review MCP tool is invalid".to_string(),
                ));
            }
            Ok(json!({ "detail": detail, "type": "mcp_tool_call" }))
        }
        "requestPermissions" => {
            let permissions = record(
                action.get("permissions").unwrap_or(&Value::Null),
                "Codex automatic approval review permissions",
            )?;
            let detail = optional_string(
                action.get("reason"),
                "Codex automatic approval review reason",
            )?
            .unwrap_or_else(|| Value::Object(permissions.clone()).to_string());
            Ok(json!({ "detail": detail, "type": "permissions" }))
        }
        _ => Err(CodexMappingError(
            "Codex automatic approval review action type is invalid".to_string(),
        )),
    }
}

fn approval_review_item(params: &Map<String, Value>) -> Result<Value, CodexMappingError> {
    let review = record(
        params.get("review").unwrap_or(&Value::Null),
        "Codex automatic approval review",
    )?;
    let status = match field_string(review, "status", "Codex automatic approval review")? {
        "inProgress" => "in_progress",
        "approved" => "approved",
        "denied" => "denied",
        "timedOut" => "timed_out",
        "aborted" => "aborted",
        _ => {
            return Err(CodexMappingError(
                "Codex automatic approval review status is invalid".to_string(),
            ));
        }
    };
    let mut item = json!({
        "action": approval_review_action(params.get("action").unwrap_or(&Value::Null))?,
        "id": format!("auto-approval-review-{}", field_string(params, "reviewId", "Codex automatic approval review")?),
        "status": status,
        "type": "approval_review"
    });
    if let Some(value) = optional_string(review.get("rationale"), "Codex approval rationale")? {
        item["rationale"] = Value::String(value);
    }
    if let Some(value) = optional_string(review.get("riskLevel"), "Codex approval risk level")? {
        if !matches!(value.as_str(), "low" | "medium" | "high" | "critical") {
            return Err(CodexMappingError(
                "Codex automatic approval review risk level is invalid".to_string(),
            ));
        }
        item["riskLevel"] = Value::String(value);
    }
    if let Some(value) = optional_string(
        review.get("userAuthorization"),
        "Codex approval authorization",
    )? {
        if !matches!(value.as_str(), "unknown" | "low" | "medium" | "high") {
            return Err(CodexMappingError(
                "Codex automatic approval review user authorization is invalid".to_string(),
            ));
        }
        item["userAuthorization"] = Value::String(value);
    }
    if let Some(value) = optional_string(params.get("targetItemId"), "Codex approval target item")?
    {
        item["targetItemId"] = Value::String(value);
    }
    Ok(item)
}

/// 映射单条 Codex 通知；未知、专用与主动忽略的方法返回 `None`。
pub fn map_codex_notification(
    method: &str,
    value: &Value,
) -> Result<Option<ProviderEvent>, CodexMappingError> {
    if !CODEX_MAPPED_NOTIFICATION_METHODS.contains(&method) {
        return Ok(None);
    }
    let params = record(value, &format!("Codex {method} params"))?;
    if method == "warning" && params.get("threadId").is_none_or(Value::is_null) {
        return Ok(None);
    }
    let task_id = field_string(params, "threadId", &format!("Codex {method}"))?;

    if method == "warning" || method == "guardianWarning" {
        return validated(json!({
            "payload": {
                "code": if method == "guardianWarning" { "guardian_warning" } else { "runtime_warning" },
                "level": "warning",
                "message": bound_chars(field_string(params, "message", &format!("Codex {method}"))?, MAX_STATUS_TEXT_CHARS)
            },
            "taskId": task_id,
            "type": "task.notice"
        }));
    }
    if method == "model/verification" {
        return validated(json!({
            "payload": {
                "code": "model_verification",
                "level": "warning",
                "message": "Model access verification is required."
            },
            "taskId": task_id,
            "type": "task.notice"
        }));
    }
    if method == "thread/tokenUsage/updated" {
        return validated(json!({
            "payload": { "usage": map_context_usage(params.get("tokenUsage").unwrap_or(&Value::Null))? },
            "taskId": task_id,
            "turnId": turn_id(params, method)?,
            "type": "usage.updated"
        }));
    }
    if method == "turn/plan/updated" {
        return validated(json!({
            "payload": { "plan": map_plan(params)? },
            "taskId": task_id,
            "turnId": turn_id(params, method)?,
            "type": "plan.updated"
        }));
    }
    if method == "turn/started" || method == "turn/completed" {
        let turn = map_codex_turn(params.get("turn").unwrap_or(&Value::Null))?;
        return validated(json!({
            "payload": { "turn": turn },
            "taskId": task_id,
            "turnId": turn["id"],
            "type": if method == "turn/started" { "turn.started" } else { "turn.completed" }
        }));
    }
    if method == "hook/started" || method == "hook/completed" {
        let item = hook_item(params, method == "hook/started")?;
        if params.get("turnId").is_none_or(Value::is_null) {
            return validated(json!({
                "payload": {
                    "code": "hook_status",
                    "level": if item["status"] == "failed" { "warning" } else { "info" },
                    "message": item.get("detail").and_then(Value::as_str).unwrap_or_else(|| item["eventName"].as_str().unwrap_or("Hook"))
                },
                "taskId": task_id,
                "type": "task.notice"
            }));
        }
        return validated(json!({
            "itemId": item["id"],
            "payload": { "item": item },
            "taskId": task_id,
            "turnId": turn_id(params, method)?,
            "type": if method == "hook/started" { "item.started" } else { "item.completed" }
        }));
    }

    let turn_id = turn_id(params, method)?;
    if method == "error" {
        let error = record(
            params.get("error").unwrap_or(&Value::Null),
            "Codex error notification",
        )?;
        let (code, status) = provider_error_info(error.get("codexErrorInfo"));
        let mut payload = json!({
            "message": field_string(error, "message", "Codex error notification")?,
            "willRetry": boolean(params.get("willRetry").unwrap_or(&Value::Null), "Codex error willRetry")?
        });
        if let Some(code) = code {
            payload["code"] = Value::String(code.to_string());
        }
        if let Some(status) = status.filter(|status| (100..=599).contains(status)) {
            payload["httpStatusCode"] = json!(status);
        }
        return validated(json!({
            "payload": payload,
            "taskId": task_id,
            "turnId": turn_id,
            "type": "provider.error"
        }));
    }

    if let Some(event) = map_delta(method, params, task_id, turn_id)? {
        return Ok(Some(event));
    }
    if method == "item/mcpToolCall/progress" {
        return validated(json!({
            "itemId": field_string(params, "itemId", "Codex MCP progress")?,
            "payload": { "message": bound_chars(field_string(params, "message", "Codex MCP progress")?, MAX_STATUS_TEXT_CHARS) },
            "taskId": task_id,
            "turnId": turn_id,
            "type": "tool.progress"
        }));
    }
    if method == "item/fileChange/patchUpdated" {
        return validated(json!({
            "itemId": field_string(params, "itemId", "Codex file change")?,
            "payload": map_realtime_changes(params.get("changes").unwrap_or(&Value::Null))?,
            "taskId": task_id,
            "turnId": turn_id,
            "type": "file_change.updated"
        }));
    }
    if method == "turn/diff/updated" {
        let (diff, original_byte_length, truncated) = bound_utf8_prefix(
            field_string(params, "diff", "Codex turn diff")?,
            MAX_REALTIME_DIFF_BYTES,
        );
        return validated(json!({
            "payload": { "diff": diff, "originalByteLength": original_byte_length, "truncated": truncated },
            "taskId": task_id,
            "turnId": turn_id,
            "type": "turn.diff_updated"
        }));
    }
    if method == "model/safetyBuffering/updated" {
        let item_id = format!("runtime-safety-{turn_id}");
        let visible = boolean(
            params.get("showBufferingUi").unwrap_or(&Value::Null),
            "Codex safety buffering UI",
        )?;
        let mut item = json!({
            "id": item_id,
            "kind": "safety_buffering",
            "model": field_string(params, "model", "Codex safety buffering")?,
            "status": if visible { "running" } else { "completed" },
            "type": "runtime_status"
        });
        if let Some(faster) = optional_string(params.get("fasterModel"), "Codex faster model")? {
            item["fasterModel"] = Value::String(faster);
        }
        return validated(json!({
            "itemId": item_id,
            "payload": { "item": item },
            "taskId": task_id,
            "turnId": turn_id,
            "type": if visible { "item.started" } else { "item.completed" }
        }));
    }
    if method == "model/rerouted" {
        let item_id = format!("runtime-reroute-{turn_id}");
        let item = json!({
            "fromModel": field_string(params, "fromModel", "Codex rerouted model")?,
            "id": item_id,
            "kind": "model_rerouted",
            "status": "completed",
            "toModel": field_string(params, "toModel", "Codex rerouted model")?,
            "type": "runtime_status"
        });
        return validated(json!({
            "itemId": item_id,
            "payload": { "item": item },
            "taskId": task_id,
            "turnId": turn_id,
            "type": "item.completed"
        }));
    }
    if method == "item/autoApprovalReview/started" || method == "item/autoApprovalReview/completed"
    {
        let item = approval_review_item(params)?;
        return validated(json!({
            "itemId": item["id"],
            "payload": { "item": item },
            "taskId": task_id,
            "turnId": turn_id,
            "type": if method == "item/autoApprovalReview/started" { "item.started" } else { "item.completed" }
        }));
    }
    if method == "item/started" || method == "item/completed" {
        let native_item = params.get("item").unwrap_or(&Value::Null);
        let native_type = native_item.get("type").and_then(Value::as_str);
        if method == "item/started"
            && matches!(
                native_type,
                Some("userMessage" | "agentMessage" | "reasoning" | "exitedReviewMode")
            )
        {
            return Ok(None);
        }
        let item = if method == "item/started" {
            ensure_started_item_running(map_codex_item(native_item)?)
        } else {
            map_codex_item(native_item)?
        };
        return validated(json!({
            "itemId": item["id"],
            "payload": { "item": item },
            "taskId": task_id,
            "turnId": turn_id,
            "type": if method == "item/started" { "item.started" } else { "item.completed" }
        }));
    }
    Ok(None)
}
