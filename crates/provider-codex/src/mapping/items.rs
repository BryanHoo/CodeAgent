use std::collections::HashMap;

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

fn collaboration_status(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_str) {
        Some("pendingInit") => "pending",
        Some("errored" | "notFound") => "failed",
        Some("shutdown") => "completed",
        _ => map_item_status(value),
    }
}

fn map_collaboration_item(
    item: &serde_json::Map<String, Value>,
    id: &str,
    subagent_nicknames: &HashMap<String, String>,
) -> Result<Value, CodexMappingError> {
    let name = match field_string(item, "tool", "Codex collaboration tool")? {
        "closeAgent" => "agent/close",
        "resumeAgent" => "agent/resume",
        "sendInput" => "agent/send_input",
        "spawnAgent" => "agent/spawn",
        "wait" => "agent/wait",
        _ => {
            return Err(CodexMappingError(
                "Codex collaboration tool is invalid".to_string(),
            ));
        }
    };
    let receiver_task_ids = item
        .get("receiverThreadIds")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CodexMappingError("Codex collaboration receivers must be an array".to_string())
        })?
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                CodexMappingError("Codex collaboration receiver must be a string".to_string())
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let states = record(
        item.get("agentsStates").unwrap_or(&Value::Null),
        "Codex collaboration agent states",
    )?;
    let agents = states
        .iter()
        .map(|(task_id, value)| {
            let state = record(value, "Codex collaboration agent state")?;
            let mut agent = json!({
                "status": collaboration_status(state.get("status")),
                "taskId": task_id
            });
            if let Some(message) = optional_string(
                state.get("message"),
                "Codex collaboration agent state message",
            )? {
                agent["message"] = Value::String(message);
            }
            if let Some(nickname) = subagent_nicknames.get(task_id) {
                agent["nickname"] = Value::String(nickname.clone());
            }
            Ok(agent)
        })
        .collect::<Result<Vec<_>, CodexMappingError>>()?;
    let mut input = json!({
        "receiverTaskIds": receiver_task_ids,
        "senderTaskId": field_string(item, "senderThreadId", "Codex collaboration sender")?
    });
    for (source, target) in [
        ("model", "model"),
        ("prompt", "prompt"),
        ("reasoningEffort", "reasoningEffort"),
    ] {
        if let Some(value) = optional_string(item.get(source), "Codex collaboration input")? {
            input[target] = Value::String(value);
        }
    }
    Ok(json!({
        "id": id,
        "input": input,
        "name": name,
        "output": { "agents": agents },
        "status": map_item_status(item.get("status")),
        "type": "tool"
    }))
}

fn map_subagent_activity(
    item: &serde_json::Map<String, Value>,
    id: &str,
) -> Result<Value, CodexMappingError> {
    field_string(item, "agentThreadId", "Codex subagent activity")?;
    let path = field_string(item, "agentPath", "Codex subagent activity")?;
    let name = path
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(path);
    let (detail, status) = match field_string(item, "kind", "Codex subagent activity")? {
        "interacted" => ("已交互", "completed"),
        "interrupted" => ("已中断", "interrupted"),
        "started" => ("已启动", "completed"),
        _ => {
            return Err(CodexMappingError(
                "Codex subagent activity kind is invalid".to_string(),
            ));
        }
    };
    Ok(json!({
        "detail": detail,
        "id": id,
        "label": format!("子代理 {name}"),
        "status": status,
        "type": "activity"
    }))
}

/// 将 Codex 原生 Item 投影成统一 `AgentItem` JSON。
pub fn map_codex_item(value: &Value) -> Result<Value, CodexMappingError> {
    map_codex_item_with_nicknames(value, &HashMap::new())
}

pub(crate) fn map_codex_item_with_nicknames(
    value: &Value,
    subagent_nicknames: &HashMap<String, String>,
) -> Result<Value, CodexMappingError> {
    let item = record(value, "Codex item")?;
    let id = field_string(item, "id", "Codex item")?;
    let kind = field_string(item, "type", "Codex item")?;
    match kind {
        "userMessage" => {
            let content = super::message_skills::map_user_message_content(item.get("content"))?;
            let mut mapped = json!({
                "id": id,
                "role": "user",
                "text": content.text,
                "type": "message"
            });
            if !content.skills.is_empty() {
                mapped["skills"] = Value::Array(content.skills);
            }
            Ok(mapped)
        }
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
        "collabAgentToolCall" => map_collaboration_item(item, id, subagent_nicknames),
        "subAgentActivity" => map_subagent_activity(item, id),
        "hookPrompt" | "contextCompaction" | "imageView" | "imageGeneration" => {
            let label = match kind {
                "hookPrompt" => "Hook 提示",
                "contextCompaction" => "上下文压缩",
                "imageView" => "查看图片",
                "imageGeneration" => "图片生成",
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
