use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use super::connection::{AppServerConnection, ConnectionError};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigReadParams {
    include_layers: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigBatchWriteParams {
    edits: Vec<ConfigEdit>,
    reload_user_config: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ConfigEdit {
    key_path: String,
    value: Value,
    merge_strategy: &'static str,
}

pub async fn get_global_settings(
    connection: &AppServerConnection,
) -> Result<Value, ConnectionError> {
    let config = read_config(connection).await?;
    Ok(json!({"settings": map_global_settings(&config)}))
}

pub async fn update_global_settings(
    connection: &AppServerConnection,
    settings: Value,
) -> Result<Value, ConnectionError> {
    validate_global_settings(&settings)?;
    let private = json!({
        "commitMessageModel": settings["commitMessageModel"],
        "commitMessagePrompt": settings["commitMessagePrompt"],
        "defaultOpenAppId": settings["defaultOpenAppId"],
        "followUpBehavior": settings["followUpBehavior"],
        "pet": settings["pet"],
    });
    write_config(
        connection,
        vec![
            edit("model", settings["model"].clone()),
            edit(
                "model_reasoning_effort",
                settings["reasoningEffort"].clone(),
            ),
            edit("approval_policy", settings["approvalPolicy"].clone()),
            edit("approvals_reviewer", settings["approvalsReviewer"].clone()),
            edit("sandbox_mode", settings["sandboxMode"].clone()),
            edit("features.fast_mode", settings["fastMode"].clone()),
            edit("desktop.codeagent.global", private),
        ],
    )
    .await?;
    Ok(json!({"settings": settings}))
}

pub async fn get_project_defaults(
    connection: &AppServerConnection,
    project_id: &str,
) -> Result<Value, ConnectionError> {
    let config = read_config(connection).await?;
    let stored = config
        .pointer("/desktop/codeagent/projectDefaults")
        .and_then(Value::as_object)
        .and_then(|projects| projects.get(project_id));
    let settings = match stored {
        Some(value) if validate_project_defaults(value).is_ok() => value.clone(),
        _ => map_project_defaults(&config),
    };
    Ok(json!({"settings": settings}))
}

pub async fn update_project_defaults(
    connection: &AppServerConnection,
    project_id: &str,
    settings: Value,
) -> Result<Value, ConnectionError> {
    validate_project_defaults(&settings)?;
    if project_id.is_empty() || project_id.contains('.') {
        return Err(ConnectionError::InvalidMessage);
    }
    write_config(
        connection,
        vec![edit(
            &format!("desktop.codeagent.projectDefaults.{project_id}"),
            settings.clone(),
        )],
    )
    .await?;
    Ok(json!({"settings": settings}))
}

pub(super) async fn read_config(
    connection: &AppServerConnection,
) -> Result<Value, ConnectionError> {
    let response: Value = connection
        .request(
            "config/read",
            &ConfigReadParams {
                include_layers: false,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    response
        .get("config")
        .cloned()
        .filter(Value::is_object)
        .ok_or(ConnectionError::InvalidMessage)
}

pub(super) async fn write_config(
    connection: &AppServerConnection,
    edits: Vec<ConfigEdit>,
) -> Result<(), ConnectionError> {
    let _: Value = connection
        .request(
            "config/batchWrite",
            &ConfigBatchWriteParams {
                edits,
                reload_user_config: true,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(())
}

pub(super) fn edit(key_path: &str, value: Value) -> ConfigEdit {
    ConfigEdit {
        key_path: key_path.to_owned(),
        value,
        merge_strategy: "replace",
    }
}

fn map_global_settings(config: &Value) -> Value {
    let private = config
        .pointer("/desktop/codeagent/global")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "approvalPolicy": config.get("approval_policy").cloned().unwrap_or_else(|| json!("on-request")),
        "approvalsReviewer": config.get("approvals_reviewer").and_then(Value::as_str).unwrap_or("user"),
        "commitMessageModel": private.get("commitMessageModel").and_then(Value::as_str).unwrap_or("gpt-5.6-luna"),
        "commitMessagePrompt": private.get("commitMessagePrompt").and_then(Value::as_str).unwrap_or_default(),
        "defaultOpenAppId": private.get("defaultOpenAppId").cloned().unwrap_or(Value::Null),
        "fastMode": config.pointer("/features/fast_mode").and_then(Value::as_bool).unwrap_or(false),
        "followUpBehavior": private.get("followUpBehavior").and_then(Value::as_str).unwrap_or("queue"),
        "model": config.get("model").and_then(Value::as_str).unwrap_or("gpt-5.6-sol"),
        "pet": private.get("pet").cloned().unwrap_or_else(|| json!({"enabled": false, "selectedPetId": null})),
        "reasoningEffort": config.get("model_reasoning_effort").and_then(Value::as_str).unwrap_or("high"),
        "sandboxMode": config.get("sandbox_mode").and_then(Value::as_str).unwrap_or("workspace-write"),
    })
}

fn map_project_defaults(config: &Value) -> Value {
    let global = map_global_settings(config);
    json!({
        "approvalPolicy": global["approvalPolicy"],
        "approvalsReviewer": global["approvalsReviewer"],
        "fastMode": global["fastMode"],
        "model": global["model"],
        "reasoningEffort": global["reasoningEffort"],
        "sandboxMode": global["sandboxMode"],
    })
}

fn validate_global_settings(settings: &Value) -> Result<(), ConnectionError> {
    validate_common_settings(settings, false)?;
    required_string(settings, "commitMessageModel", 256)?;
    required_string_allow_empty(settings, "commitMessagePrompt", 4_000)?;
    if !matches!(
        settings.get("defaultOpenAppId"),
        Some(Value::Null) | Some(Value::String(_))
    ) || !matches!(
        settings.get("followUpBehavior").and_then(Value::as_str),
        Some("queue" | "steer")
    ) || !valid_pet(settings.get("pet"))
    {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn validate_project_defaults(settings: &Value) -> Result<(), ConnectionError> {
    validate_common_settings(settings, true)
}

fn validate_common_settings(
    settings: &Value,
    allow_untrusted: bool,
) -> Result<(), ConnectionError> {
    required_string(settings, "model", 256)?;
    required_string(settings, "reasoningEffort", 64)?;
    let approval = settings
        .get("approvalPolicy")
        .ok_or(ConnectionError::InvalidMessage)?;
    let approval_valid = matches!(approval.as_str(), Some("on-request" | "never"))
        || (allow_untrusted && approval.as_str() == Some("untrusted"))
        || approval.get("granular").is_some_and(Value::is_object);
    if !approval_valid
        || !matches!(
            settings.get("approvalsReviewer").and_then(Value::as_str),
            Some("user" | "auto_review")
        )
        || !matches!(
            settings.get("sandboxMode").and_then(Value::as_str),
            Some("read-only" | "workspace-write" | "danger-full-access")
        )
        || !settings.get("fastMode").is_some_and(Value::is_boolean)
    {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn required_string(value: &Value, key: &str, max: usize) -> Result<(), ConnectionError> {
    let text = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    if text.trim().is_empty() || text.len() > max {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn required_string_allow_empty(
    value: &Value,
    key: &str,
    max: usize,
) -> Result<(), ConnectionError> {
    let text = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    if text.len() > max {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn valid_pet(value: Option<&Value>) -> bool {
    value.is_some_and(|pet| {
        pet.get("enabled").is_some_and(Value::is_boolean)
            && matches!(
                pet.get("selectedPetId"),
                Some(Value::Null) | Some(Value::String(_))
            )
    })
}
