use std::collections::HashMap;

use code_agent_core::CodeAgentError;
use code_agent_protocol::{ValueDefinition, parse_protocol_value};
use serde_json::{Value, json};

use crate::{
    JsonlRpcClient, historical_attachments::HistoricalAttachmentStore, map_codex_turn,
    rpc_error_to_code_agent_error,
};

pub(crate) async fn map_history_turns(
    client: &JsonlRpcClient,
    attachments: &HistoricalAttachmentStore,
    task_id: &str,
    parent_turns: &[Value],
) -> Result<Vec<Value>, CodeAgentError> {
    let review_indexes = parent_turns
        .iter()
        .enumerate()
        .filter_map(|(index, turn)| has_review_container(turn).then_some(index))
        .collect::<Vec<_>>();
    if review_indexes.is_empty() {
        return map_turns(parent_turns, attachments, task_id).await;
    }

    let response = client
        .request(
            "thread/list",
            Some(json!({
                "limit": 100,
                "parentThreadId": task_id,
                "sortDirection": "asc",
                "sortKey": "created_at",
                "sourceKinds": ["subAgentReview"]
            })),
        )
        .await
        .map_err(|error| rpc_error_to_code_agent_error(&error))?;
    let workers = response["data"]
        .as_array()
        .ok_or_else(|| CodeAgentError::internal("review worker thread/list data is invalid"))?;
    let mut worker_turns = Vec::new();
    for worker in workers.iter().take(review_indexes.len()) {
        let worker_id = worker["id"]
            .as_str()
            .ok_or_else(|| CodeAgentError::internal("review worker thread id is invalid"))?;
        let response = client
            .request(
                "thread/turns/list",
                Some(json!({
                    "itemsView": "full",
                    "limit": 1,
                    "sortDirection": "desc",
                    "threadId": worker_id
                })),
            )
            .await
            .map_err(|error| rpc_error_to_code_agent_error(&error))?;
        let turns = response["data"]
            .as_array()
            .ok_or_else(|| CodeAgentError::internal("review worker turns are invalid"))?;
        worker_turns.push(turns.first().cloned());
    }

    let mut mapped = Vec::with_capacity(parent_turns.len());
    let mut worker_index = 0;
    for (index, parent_turn) in parent_turns.iter().enumerate() {
        let mut parent = map_turn(parent_turn, attachments, task_id).await?;
        if review_indexes.get(worker_index) != Some(&index) {
            mapped.push(parent);
            continue;
        }
        if let Some(worker_turn) = worker_turns.get(worker_index).and_then(Option::as_ref) {
            let worker = map_turn(worker_turn, attachments, task_id).await?;
            merge_review_turn(parent_turn, &mut parent, &worker);
        }
        mapped.push(validate_turn(parent)?);
        worker_index += 1;
    }
    Ok(mapped)
}

async fn map_turns(
    turns: &[Value],
    attachments: &HistoricalAttachmentStore,
    task_id: &str,
) -> Result<Vec<Value>, CodeAgentError> {
    let mut mapped = Vec::with_capacity(turns.len());
    for turn in turns {
        mapped.push(map_turn(turn, attachments, task_id).await?);
    }
    Ok(mapped)
}

async fn map_turn(
    native: &Value,
    attachments: &HistoricalAttachmentStore,
    task_id: &str,
) -> Result<Value, CodeAgentError> {
    let mut mapped =
        map_codex_turn(native).map_err(|error| CodeAgentError::internal(error.to_string()))?;
    let Some(native_items) = native["items"].as_array() else {
        return validate_turn(mapped);
    };
    let Some(mapped_items) = mapped["items"].as_array_mut() else {
        return validate_turn(mapped);
    };
    let mapped_indexes = mapped_items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| item["id"].as_str().map(|id| (id.to_string(), index)))
        .collect::<HashMap<_, _>>();
    for native_item in native_items {
        let Some(item_id) = native_item["id"].as_str() else {
            continue;
        };
        let Some(mapped_index) = mapped_indexes.get(item_id).copied() else {
            continue;
        };
        let mapped_item = &mut mapped_items[mapped_index];
        if native_item["type"] == "imageGeneration" {
            if native_item["status"] == "completed"
                && let Some(encoded) = native_item["result"].as_str()
                && let Some(attachment) = attachments.add_base64_image(task_id, encoded, 0)
            {
                *mapped_item = json!({
                    "attachments": [attachment],
                    "id": native_item["id"],
                    "role": "assistant",
                    "text": "",
                    "type": "message"
                });
            }
            continue;
        }
        if native_item["type"] != "userMessage" {
            continue;
        }
        let Some(content) = native_item["content"].as_array() else {
            continue;
        };
        let mut metadata = Vec::new();
        let mut visible_text = Vec::new();
        let mut image_index = 0;
        let mut text_index = 0;
        for part in content {
            match part["type"].as_str() {
                Some("localImage") => {
                    if let Some(path) = part["path"].as_str()
                        && let Some(attachment) = attachments
                            .add_local_image(task_id, path, image_index)
                            .await
                    {
                        metadata.push(attachment);
                    }
                    image_index += 1;
                }
                Some("image") => {
                    if let Some(url) = part["url"].as_str()
                        && let Some(attachment) = attachments.add_data_url(
                            task_id,
                            url,
                            part["name"].as_str(),
                            image_index,
                        )
                    {
                        metadata.push(attachment);
                    }
                    image_index += 1;
                }
                Some("text" | "inputText") => {
                    let text = part["text"].as_str().unwrap_or_default();
                    let (part_text, mut part_attachments) =
                        map_text_part(attachments, task_id, part, text, text_index);
                    text_index += part_attachments.len();
                    metadata.append(&mut part_attachments);
                    let extracted = crate::mapping::message_skills::extract_text_skills(&part_text);
                    if !extracted.text.is_empty() {
                        visible_text.push(extracted.text);
                    }
                }
                Some("audio" | "localAudio") => visible_text.push("[音频]".to_string()),
                _ => {}
            }
        }
        mapped_item["text"] = Value::String(visible_text.join("\n"));
        crate::mapping::message_skills::normalize_message_skill_references(mapped_item);
        if !metadata.is_empty() {
            mapped_item["attachments"] = Value::Array(metadata);
        }
    }
    validate_turn(mapped)
}

fn validate_turn(turn: Value) -> Result<Value, CodeAgentError> {
    parse_protocol_value(ValueDefinition::AgentTurn, turn)
        .map_err(|error| CodeAgentError::internal(error.to_string()))
}

fn map_text_part(
    attachments: &HistoricalAttachmentStore,
    task_id: &str,
    part: &Value,
    text: &str,
    text_index: usize,
) -> (String, Vec<Value>) {
    let Some(elements) = part["text_elements"]
        .as_array()
        .filter(|items| !items.is_empty())
    else {
        return (text.to_string(), Vec::new());
    };
    let bytes = text.as_bytes();
    let mut ranges = elements
        .iter()
        .filter_map(|element| {
            let start = element["byteRange"]["start"].as_u64()? as usize;
            let end = element["byteRange"]["end"].as_u64()? as usize;
            let name = element["placeholder"].as_str()?;
            (start < end && end <= bytes.len()).then_some((start, end, name))
        })
        .collect::<Vec<_>>();
    if ranges.len() != elements.len() {
        return (text.to_string(), Vec::new());
    }
    ranges.sort_by_key(|(start, _, _)| *start);
    let mut cursor = 0;
    let mut visible = String::new();
    let mut metadata = Vec::new();
    for (index, (start, end, name)) in ranges.into_iter().enumerate() {
        if start < cursor {
            return (text.to_string(), Vec::new());
        }
        let (Ok(prefix), Ok(content)) = (
            std::str::from_utf8(&bytes[cursor..start]),
            std::str::from_utf8(&bytes[start..end]),
        ) else {
            return (text.to_string(), Vec::new());
        };
        visible.push_str(prefix);
        if let Some(attachment) =
            attachments.add_text(task_id, name, content.as_bytes(), text_index + index)
        {
            metadata.push(attachment);
        } else {
            visible.push('@');
            visible.push_str(name);
        }
        cursor = end;
    }
    let Ok(suffix) = std::str::from_utf8(&bytes[cursor..]) else {
        return (text.to_string(), Vec::new());
    };
    visible.push_str(suffix);
    (visible, metadata)
}

fn has_review_container(turn: &Value) -> bool {
    turn["items"].as_array().is_some_and(|items| {
        items.iter().any(|item| {
            matches!(
                item["type"].as_str(),
                Some("enteredReviewMode" | "exitedReviewMode")
            )
        })
    })
}

fn merge_review_turn(native_parent: &Value, parent: &mut Value, worker: &Value) {
    // Review worker 是 Codex 的实现细节；历史恢复必须继续投影到唯一的外层审查 Turn。
    let worker_items = worker["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| !(item["type"] == "message" && item["role"] == "user"))
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let worker_has_response = worker_items
        .iter()
        .any(|item| item["type"] == "message" && item["role"] == "assistant");
    let parent_items = parent["items"].as_array().cloned().unwrap_or_default();
    let mut items = parent_items
        .iter()
        .filter(|item| item["type"] == "review")
        .cloned()
        .collect::<Vec<_>>();
    items.extend(worker_items);
    if !worker_has_response {
        items.extend(
            parent_items
                .into_iter()
                .filter(|item| item["type"] == "message" && item["role"] == "assistant"),
        );
    }
    parent["items"] = Value::Array(items);
    parent["error"] = if worker["error"].is_null() {
        parent["error"].clone()
    } else {
        worker["error"].clone()
    };
    if !worker["startedAt"].is_null() {
        parent["startedAt"] = worker["startedAt"].clone();
    }
    let has_outer_exit = native_parent["items"]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["type"] == "exitedReviewMode"));
    if has_outer_exit {
        if parent["completedAt"].is_null() {
            parent["completedAt"] = worker["completedAt"].clone();
        }
        parent["status"] = worker["status"].clone();
    } else {
        parent["completedAt"] = Value::Null;
        parent["status"] = Value::String("running".to_string());
    }
}
