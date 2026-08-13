use std::collections::HashSet;

use serde_json::{Map, Value, json};

use super::common::{CodexMappingError, field_string, record};

pub(crate) struct UserMessageContent {
    pub skills: Vec<Value>,
    pub text: String,
}

pub(crate) fn map_user_message_content(
    value: Option<&Value>,
) -> Result<UserMessageContent, CodexMappingError> {
    let content = value.and_then(Value::as_array).ok_or_else(|| {
        CodexMappingError("Codex user message content must be an array".to_string())
    })?;
    let mut skills = Vec::new();
    let mut texts = Vec::new();
    for part in content {
        let part = record(part, "Codex user message part")?;
        match field_string(part, "type", "Codex user message part")? {
            "text" | "inputText" => {
                let text = field_string(part, "text", "Codex user message part")?;
                let extracted = extract_text_skills(text);
                skills.extend(
                    extracted
                        .skills
                        .into_iter()
                        .map(|name| json!({ "name": name })),
                );
                if !extracted.text.is_empty() {
                    texts.push(extracted.text);
                }
            }
            "skill" => {
                let name = field_string(part, "name", "Codex user message skill")?;
                // 原生路径只用于确认 Skill 结构完整，禁止进入公共消息。
                field_string(part, "path", "Codex user message skill")?;
                skills.push(json!({ "name": name }));
            }
            _ => {}
        }
    }
    Ok(UserMessageContent {
        skills,
        text: texts.join("\n"),
    })
}

pub(crate) struct ExtractedTextSkills {
    pub skills: Vec<String>,
    pub text: String,
}

pub(crate) fn extract_text_skills(text: &str) -> ExtractedTextSkills {
    if let Some(name) = expanded_skill_name(text) {
        return ExtractedTextSkills {
            skills: vec![name.to_string()],
            text: String::new(),
        };
    }

    let mut skills = Vec::new();
    let mut visible = String::with_capacity(text.len());
    let mut remaining = text;
    while let Some(start) = remaining.find("[$") {
        visible.push_str(&remaining[..start]);
        let candidate = &remaining[start + 2..];
        let Some(name_end) = candidate.find("](") else {
            visible.push_str(&remaining[start..]);
            remaining = "";
            break;
        };
        let name = &candidate[..name_end];
        let path_start = name_end + 2;
        let Some(path_end) = candidate[path_start..].find(')') else {
            visible.push_str(&remaining[start..]);
            remaining = "";
            break;
        };
        let path_end = path_start + path_end;
        let path = &candidate[path_start..path_end];
        if name.is_empty() || name.chars().any(char::is_whitespace) || !path.ends_with("/SKILL.md")
        {
            visible.push_str(&remaining[..start + 2]);
            remaining = candidate;
            continue;
        }
        skills.push(name.to_string());
        remaining = &candidate[path_end + 1..];
    }
    visible.push_str(remaining);
    let text = if skills.is_empty() {
        text.to_string()
    } else {
        visible.trim_start().to_string()
    };
    ExtractedTextSkills { skills, text }
}

fn expanded_skill_name(text: &str) -> Option<&str> {
    let text = text.trim();
    let content = text
        .strip_prefix("<skill>")?
        .strip_suffix("</skill>")?
        .trim_start();
    let name_content = content.strip_prefix("<name>")?;
    let name_end = name_content.find("</name>")?;
    let name = name_content[..name_end].trim();
    let path_content = name_content[name_end + "</name>".len()..]
        .trim_start()
        .strip_prefix("<path>")?;
    let path_end = path_content.find("</path>")?;
    let path = path_content[..path_end].trim();
    (!name.is_empty() && !path.is_empty() && !name.contains('<') && !path.contains('<'))
        .then_some(name)
}

pub(crate) fn merge_expanded_skill_messages(items: Vec<Value>) -> Vec<Value> {
    let mut merged = Vec::<Value>::with_capacity(items.len());
    for item in items {
        if is_skill_only_user_message(&item)
            && let Some(previous) = merged.last_mut()
            && is_user_message(previous)
        {
            merge_message_skills(previous, &item);
            continue;
        }
        merged.push(item);
    }
    merged
}

fn is_user_message(item: &Value) -> bool {
    item["type"] == "message" && item["role"] == "user"
}

fn is_skill_only_user_message(item: &Value) -> bool {
    is_user_message(item)
        && item["text"].as_str() == Some("")
        && item["skills"]
            .as_array()
            .is_some_and(|skills| !skills.is_empty())
}

fn merge_message_skills(previous: &mut Value, current: &Value) {
    let mut names = previous["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|skill| skill["name"].as_str().map(str::to_string))
        .collect::<HashSet<_>>();
    let mut skills = previous["skills"].as_array().cloned().unwrap_or_default();
    for skill in current["skills"].as_array().into_iter().flatten() {
        if let Some(name) = skill["name"].as_str()
            && names.insert(name.to_string())
        {
            skills.push(skill.clone());
        }
    }
    let text = previous["text"].as_str().unwrap_or_default();
    previous["text"] = Value::String(strip_leading_skill_references(text, &names));
    previous["skills"] = Value::Array(skills);
}

pub(crate) fn strip_leading_skill_references(text: &str, names: &HashSet<String>) -> String {
    let mut remaining = text;
    let mut removed = false;
    loop {
        let trimmed = remaining.trim_start();
        let Some(reference) = trimmed.strip_prefix('$') else {
            break;
        };
        let end = reference
            .find(|character: char| character.is_whitespace() || character == '$')
            .unwrap_or(reference.len());
        if end == 0 || !names.contains(&reference[..end]) {
            break;
        }
        remaining = &reference[end..];
        removed = true;
    }
    if removed {
        remaining.trim_start().to_string()
    } else {
        text.to_string()
    }
}

pub(crate) fn append_skills(item: &mut Map<String, Value>, names: &[String]) {
    if names.is_empty() {
        return;
    }
    let skills = item
        .entry("skills")
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(skills) = skills.as_array_mut() else {
        return;
    };
    let mut existing = skills
        .iter()
        .filter_map(|skill| skill["name"].as_str().map(str::to_string))
        .collect::<HashSet<_>>();
    for name in names {
        if existing.insert(name.clone()) {
            skills.push(json!({ "name": name }));
        }
    }
}

pub(crate) fn attach_turn_skills(turn: &mut Value, names: &[String]) {
    let Some(items) = turn["items"].as_array_mut() else {
        return;
    };
    let Some(message) = items
        .iter_mut()
        .find(|item| item["type"] == "message" && item["role"] == "user")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    append_skills(message, names);
    let skill_names = message["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|skill| skill["name"].as_str().map(str::to_string))
        .collect::<HashSet<_>>();
    if let Some(text) = message["text"].as_str() {
        message.insert(
            "text".to_string(),
            Value::String(strip_leading_skill_references(text, &skill_names)),
        );
    }
}

pub(crate) fn normalize_message_skill_references(message: &mut Value) {
    let skill_names = message["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|skill| skill["name"].as_str().map(str::to_string))
        .collect::<HashSet<_>>();
    if skill_names.is_empty() {
        return;
    }
    let Some(text) = message["text"].as_str() else {
        return;
    };
    message["text"] = Value::String(strip_leading_skill_references(text, &skill_names));
}
