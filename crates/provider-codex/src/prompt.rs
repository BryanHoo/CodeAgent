use std::collections::HashMap;

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use data_encoding::BASE64;
use serde_json::{Value, json};

use crate::skill_mapping::NativeSkill;

pub(crate) async fn map_prompt(
    prompt: &Value,
    skills: &HashMap<String, NativeSkill>,
) -> Result<Vec<Value>, CodeAgentError> {
    let references = array(prompt, "skills")?;
    let mut input = Vec::with_capacity(references.len() + array(prompt, "attachments")?.len() + 1);
    for reference in references {
        let id = string(reference, "id")?;
        let name = string(reference, "name")?;
        let skill = skills
            .get(id)
            .filter(|skill| skill.name == name)
            .ok_or_else(|| invalid("prompt skill is unavailable"))?;
        input.push(json!({ "name": skill.name, "path": skill.path, "type": "skill" }));
    }
    if let Some(text) = prompt["text"].as_str().filter(|text| !text.is_empty()) {
        input.push(text_part(text, Vec::new()));
    } else if !references.is_empty() {
        let index = references
            .iter()
            .map(|reference| string(reference, "name").map(|name| format!("${name}")))
            .collect::<Result<Vec<_>, _>>()?
            .join(" ");
        input.insert(0, text_part(&index, Vec::new()));
    }
    for attachment in array(prompt, "attachments")? {
        match string(attachment, "kind")? {
            "text" => {
                let owned;
                let text = if let Some(text) = attachment["text"].as_str() {
                    text
                } else {
                    let bytes = tokio::fs::read(string(attachment, "path")?)
                        .await
                        .map_err(|_| invalid("prompt text attachment is unavailable"))?;
                    owned = String::from_utf8(bytes)
                        .map_err(|_| invalid("prompt text attachment is not UTF-8"))?;
                    owned.as_str()
                };
                input.push(text_part(
                    text,
                    vec![json!({
                        "byteRange": { "end": text.len(), "start": 0 },
                        "placeholder": string(attachment, "name")?
                    })],
                ));
            }
            "file" => input.push(text_part(string(attachment, "path")?, Vec::new())),
            "image" => {
                let encoded = if let Some(data) = attachment["data"].as_str() {
                    data.to_owned()
                } else {
                    let bytes = tokio::fs::read(string(attachment, "path")?)
                        .await
                        .map_err(|_| invalid("prompt image attachment is unavailable"))?;
                    BASE64.encode(&bytes)
                };
                input.push(json!({
                    "type": "image",
                    "url": format!("data:{};base64,{encoded}", string(attachment, "mediaType")?)
                }));
            }
            _ => return Err(invalid("prompt attachment kind is invalid")),
        }
    }
    if input.is_empty() {
        return Err(invalid("prompt input must not be empty"));
    }
    Ok(input)
}

pub(crate) fn map_turn_options(options: &Value) -> Result<Value, CodeAgentError> {
    let model = string(options, "model")?;
    let effort = string(options, "reasoningEffort")?;
    let sandbox = match string(options, "sandboxMode")? {
        "read-only" => json!({ "networkAccess": false, "type": "readOnly" }),
        "danger-full-access" => json!({ "type": "dangerFullAccess" }),
        "workspace-write" => json!({
            "networkAccess": false,
            "type": "workspaceWrite",
            "writableRoots": []
        }),
        _ => return Err(invalid("turn sandbox mode is invalid")),
    };
    Ok(json!({
        "approvalPolicy": string(options, "approvalPolicy")?,
        "approvalsReviewer": string(options, "approvalsReviewer")?,
        "collaborationMode": {
            "mode": options["collaborationMode"].as_str().unwrap_or("default"),
            "settings": {
                "developer_instructions": null,
                "model": model,
                "reasoning_effort": effort
            }
        },
        "effort": effort,
        "model": model,
        "sandboxPolicy": sandbox
    }))
}

fn text_part(text: &str, text_elements: Vec<Value>) -> Value {
    json!({ "text": text, "text_elements": text_elements, "type": "text" })
}

fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>, CodeAgentError> {
    value[key]
        .as_array()
        .ok_or_else(|| invalid("prompt collection is invalid"))
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CodeAgentError> {
    value[key]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("prompt field is invalid"))
}

fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}
