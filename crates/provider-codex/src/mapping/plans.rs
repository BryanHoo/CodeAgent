use serde_json::{Map, Value, json};

use super::common::{CodexMappingError, field_string, record};

pub(super) fn map_plan(params: &Map<String, Value>) -> Result<Value, CodexMappingError> {
    let explanation = match params.get("explanation") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::String(value)) => Value::String(value.clone()),
        Some(_) => {
            return Err(CodexMappingError(
                "Codex plan explanation must be a string or null".to_string(),
            ));
        }
    };
    let steps = params
        .get("plan")
        .and_then(Value::as_array)
        .ok_or_else(|| CodexMappingError("Codex plan must be an array".to_string()))?
        .iter()
        .map(|step| {
            let step = record(step, "Codex plan step")?;
            let status = match field_string(step, "status", "Codex plan step")? {
                "inProgress" => "in_progress",
                "pending" => "pending",
                "completed" => "completed",
                _ => {
                    return Err(CodexMappingError(
                        "Codex plan step status is invalid".to_string(),
                    ));
                }
            };
            Ok(json!({
                "status": status,
                "text": field_string(step, "step", "Codex plan step")?
            }))
        })
        .collect::<Result<Vec<_>, CodexMappingError>>()?;
    Ok(json!({ "explanation": explanation, "steps": steps }))
}
