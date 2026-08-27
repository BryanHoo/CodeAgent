use serde_json::{Value, json};

use super::connection::ConnectionError;
use crate::domain::conversation::AgentPromptInput;

pub(super) fn map_prompt_input(input: &AgentPromptInput) -> Result<Vec<Value>, ConnectionError> {
    let mut native = Vec::with_capacity(1 + input.attachments.len() + input.skills.len());
    if !input.text.is_empty() {
        native.push(json!({"text": input.text, "textElements": [], "type": "text"}));
    }
    for attachment in &input.attachments {
        match attachment.get("kind").and_then(Value::as_str) {
            Some("text") => native.push(json!({
                "text": object_string(attachment, "content")?,
                "textElements": [],
                "type": "text",
            })),
            None | Some("image") => native.push(json!({
                "path": object_string(attachment, "id")?,
                "type": "localImage",
            })),
            _ => return Err(ConnectionError::InvalidMessage),
        }
    }
    for skill in &input.skills {
        native.push(json!({
            "name": object_string(skill, "name")?,
            "path": object_string(skill, "id")?,
            "type": "skill",
        }));
    }
    if native.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(native)
}

fn object_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, ConnectionError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(ConnectionError::InvalidMessage)
}
