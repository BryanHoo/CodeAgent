use serde_json::{Value, json};

use super::common::{
    CodexMappingError, bound_command_output, field_string, integer, map_file_change_kind,
    map_item_status, optional_string, record,
};

fn strings_joined(value: Option<&Value>, context: &str) -> Result<String, CodexMappingError> {
    let Some(value) = value else {
        return Ok(String::new());
    };
    let values = value
        .as_array()
        .ok_or_else(|| CodexMappingError(format!("{context} must be an array")))?;
    Ok(values
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("\n"))
}

fn map_user_message_content(value: Option<&Value>) -> Result<String, CodexMappingError> {
    let Some(value) = value else {
        return Ok(String::new());
    };
    let content = value.as_array().ok_or_else(|| {
        CodexMappingError("Codex user message content must be an array".to_string())
    })?;
    let mut texts = Vec::new();
    for part in content {
        let part = record(part, "Codex user message part")?;
        let kind = field_string(part, "type", "Codex user message part")?;
        if kind == "text" || kind == "inputText" {
            texts.push(field_string(part, "text", "Codex user message part")?);
        }
    }
    Ok(texts.join("\n"))
}

/// 将 Codex 原生 Item 投影成统一 `AgentItem` JSON。
pub fn map_codex_item(value: &Value) -> Result<Value, CodexMappingError> {
    let item = record(value, "Codex item")?;
    let id = field_string(item, "id", "Codex item")?;
    let kind = field_string(item, "type", "Codex item")?;
    match kind {
        "userMessage" => Ok(json!({
            "id": id,
            "role": "user",
            "text": map_user_message_content(item.get("content"))?,
            "type": "message"
        })),
        "agentMessage" => {
            let mut mapped = json!({
                "id": id,
                "role": "assistant",
                "text": field_string(item, "text", "Codex agent message")?,
                "type": "message"
            });
            if let Some(phase) = optional_string(item.get("phase"), "Codex agent message phase")?
                && (phase == "commentary" || phase == "final_answer")
            {
                mapped["phase"] = Value::String(phase);
            }
            Ok(mapped)
        }
        "reasoning" => Ok(json!({
            "content": strings_joined(item.get("content"), "Codex reasoning content")?,
            "id": id,
            "summary": strings_joined(item.get("summary"), "Codex reasoning summary")?,
            "type": "reasoning"
        })),
        "commandExecution" => {
            let output = optional_string(item.get("aggregatedOutput"), "Codex command output")?;
            let bounded = output.as_deref().map(bound_command_output);
            let mut mapped = json!({
                "command": field_string(item, "command", "Codex command")?,
                "cwd": field_string(item, "cwd", "Codex command")?,
                "id": id,
                "outputTruncated": bounded.as_ref().is_some_and(|(_, truncated)| *truncated),
                "status": map_item_status(item.get("status")),
                "type": "command"
            });
            if let Some(exit_code) = item.get("exitCode").filter(|value| !value.is_null()) {
                mapped["exitCode"] = json!(integer(exit_code, "Codex command exitCode")?);
            }
            if let Some((output, _)) = bounded {
                mapped["output"] = Value::String(output);
            }
            Ok(mapped)
        }
        "fileChange" => {
            let changes = item
                .get("changes")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    CodexMappingError("Codex file changes must be an array".to_string())
                })?;
            let mapped = changes
                .iter()
                .map(|change| {
                    let change = record(change, "Codex file change")?;
                    Ok(json!({
                        "diff": field_string(change, "diff", "Codex file change")?,
                        "kind": map_file_change_kind(change.get("kind").unwrap_or(&Value::Null))?,
                        "path": field_string(change, "path", "Codex file change")?
                    }))
                })
                .collect::<Result<Vec<_>, CodexMappingError>>()?;
            Ok(json!({
                "changes": mapped,
                "id": id,
                "status": map_item_status(item.get("status")),
                "type": "file_change"
            }))
        }
        "mcpToolCall" | "dynamicToolCall" => {
            let name = if kind == "mcpToolCall" {
                format!(
                    "{}/{}",
                    field_string(item, "server", "Codex MCP tool")?,
                    field_string(item, "tool", "Codex MCP tool")?
                )
            } else {
                let tool = field_string(item, "tool", "Codex dynamic tool")?;
                optional_string(item.get("namespace"), "Codex dynamic tool namespace")?.map_or_else(
                    || tool.to_string(),
                    |namespace| format!("{namespace}/{tool}"),
                )
            };
            let mut mapped = json!({
                "id": id,
                "name": name,
                "status": map_item_status(item.get("status")),
                "type": "tool"
            });
            if let Some(input) = item.get("arguments") {
                mapped["input"] = input.clone();
            }
            if let Some(output) = item.get("result").or_else(|| item.get("contentItems")) {
                mapped["output"] = output.clone();
            } else if let Some(error) = item.get("error").filter(|value| !value.is_null()) {
                let error = record(error, "Codex tool error")?;
                mapped["output"] = json!({
                    "error": field_string(error, "message", "Codex tool error")?
                });
            }
            Ok(mapped)
        }
        "webSearch" => {
            let mut mapped = json!({
                "id": id,
                "input": { "query": field_string(item, "query", "Codex web search")? },
                "name": "web_search",
                "status": "completed",
                "type": "tool"
            });
            if let Some(results) = item.get("results").filter(|value| !value.is_null()) {
                mapped["output"] = results.clone();
            }
            Ok(mapped)
        }
        "plan" => Ok(json!({
            "id": id,
            "text": field_string(item, "text", "Codex plan")?,
            "type": "plan"
        })),
        "enteredReviewMode" => Ok(json!({
            "id": id,
            "target": map_review_target(field_string(item, "review", "Codex review")?),
            "type": "review"
        })),
        "exitedReviewMode" => Ok(json!({
            "id": id,
            "role": "assistant",
            "text": field_string(item, "review", "Codex review result")?,
            "type": "message"
        })),
        "sleep" => Ok(json!({
            "detail": format!("{}ms", item.get("durationMs").and_then(Value::as_i64).unwrap_or(0)),
            "id": id,
            "label": "等待",
            "type": "activity"
        })),
        "hookPrompt"
        | "contextCompaction"
        | "imageView"
        | "subAgentActivity"
        | "imageGeneration"
        | "collabAgentToolCall" => {
            let label = match kind {
                "hookPrompt" => "Hook 提示",
                "contextCompaction" => "上下文压缩",
                "imageView" => "查看图片",
                "imageGeneration" => "图片生成",
                "subAgentActivity" => "子代理活动",
                _ => "协作代理",
            };
            Ok(json!({ "id": id, "label": label, "type": "activity" }))
        }
        _ => Ok(json!({
            "detail": format!("未识别的活动类型: {kind}"),
            "id": id,
            "label": "Provider 活动",
            "type": "activity"
        })),
    }
}

pub(crate) fn map_review_target(value: &str) -> Value {
    let normalized = value.trim();
    if normalized.eq_ignore_ascii_case("uncommittedChanges")
        || normalized.contains("uncommitted")
        || normalized.contains("未提交")
    {
        return json!({ "type": "uncommitted_changes" });
    }
    if let Some(branch) = normalized.strip_prefix("baseBranch:") {
        return json!({ "branch": branch.trim(), "type": "base_branch" });
    }
    if let Some(sha) = normalized.strip_prefix("commit:") {
        return json!({ "sha": sha.trim(), "type": "commit" });
    }
    json!({ "instructions": normalized, "type": "custom" })
}

pub(crate) fn ensure_started_item_running(mut item: Value) -> Value {
    if matches!(
        item["type"].as_str(),
        Some("command" | "file_change" | "tool" | "activity")
    ) {
        item["status"] = Value::String("running".to_string());
    }
    item
}
