use serde_json::{Value, json};

use super::connection::ConnectionError;
use super::conversation_file_input::create_file_text_input;
use crate::domain::conversation::AgentPromptInput;

pub(super) fn map_prompt_input(input: &AgentPromptInput) -> Result<Vec<Value>, ConnectionError> {
    let mut native = Vec::with_capacity(1 + input.attachments.len() + input.skills.len());
    if !input.text.is_empty() {
        native.push(json!({"text": input.text, "text_elements": [], "type": "text"}));
    }
    for attachment in &input.attachments {
        match attachment.get("kind").and_then(Value::as_str) {
            Some("file" | "text") => native.push(create_file_text_input(attachment)?),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_text_should_follow_codex_149_wire_schema() {
        let input = AgentPromptInput::text("读取附件");
        let native = map_prompt_input(&input).expect("prompt should map");

        assert_eq!(native[0]["text_elements"], json!([]));
        assert!(native[0].get("textElements").is_none());
    }

    #[test]
    fn prompt_file_should_preserve_attachment_identity_in_text_elements() {
        let input = AgentPromptInput {
            attachments: vec![json!({
                "id": "/tmp/report.json",
                "kind": "file",
                "mediaType": "application/json",
                "name": "report.json",
                "size": 17,
            })],
            skills: Vec::new(),
            text: "检查附件".to_owned(),
        };

        let native = map_prompt_input(&input).expect("file prompt should map");
        assert_eq!(native[1]["text"], "/tmp/report.json");
        assert_eq!(
            native[1]["text_elements"][0]["byteRange"],
            json!({"start": 0, "end": 16})
        );
        assert!(
            native[1]["text_elements"][0]["placeholder"]
                .as_str()
                .is_some_and(|value| value.starts_with("codexly-file:"))
        );
    }
}
