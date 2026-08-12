use code_agent_core::CodeAgentError;
use code_agent_protocol::AgentSkillPage;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub(crate) fn map_skills(
    response: &Value,
    project_root: &str,
) -> Result<AgentSkillPage, CodeAgentError> {
    let project_entry = response["data"]
        .as_array()
        .and_then(|entries| {
            entries
                .iter()
                .find(|entry| entry["cwd"].as_str() == Some(project_root))
        })
        .ok_or_else(|| CodeAgentError::internal("skills/list did not return the active project"))?;
    let skills = project_entry["skills"]
        .as_array()
        .ok_or_else(|| CodeAgentError::internal("skills/list skills must be an array"))?;

    let data = skills
        .iter()
        .filter(|skill| skill["enabled"].as_bool() == Some(true))
        .map(map_skill)
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::from_value(json!({ "data": data, "nextCursor": null }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
}

fn map_skill(skill: &Value) -> Result<Value, CodeAgentError> {
    let name = required_string(skill, "name")?;
    let path = required_string(skill, "path")?;
    let scope = required_string(skill, "scope")?;
    if !matches!(scope, "user" | "repo" | "system" | "admin") {
        return Err(CodeAgentError::internal(
            "skills/list skill scope is invalid",
        ));
    }
    let interface = skill.get("interface").and_then(Value::as_object);
    let display_name = interface
        .and_then(|value| value.get("displayName"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(name);
    let description = interface
        .and_then(|value| value.get("shortDescription"))
        .and_then(Value::as_str)
        .or_else(|| skill["shortDescription"].as_str())
        .or_else(|| skill["description"].as_str())
        .unwrap_or_default();
    let digest = format!("{:x}", Sha256::digest(format!("{name}\0{path}").as_bytes()));

    Ok(json!({
        "description": description,
        "displayName": display_name,
        "id": format!("skill_{}", &digest[..32]),
        "name": name,
        "scope": scope
    }))
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CodeAgentError> {
    value[key]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CodeAgentError::internal(format!("skills/list skill {key} is invalid")))
}
