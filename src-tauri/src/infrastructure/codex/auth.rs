use std::{collections::HashSet, time::Duration};

use serde::Serialize;
use serde_json::{Value, json};

use super::{
    catalogs::list_models,
    connection::{AppServerConnection, ConnectionError},
    settings::{edit, read_config, write_config},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CUSTOM_PROVIDER_ID: &str = "codeagent-custom";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountReadParams {
    refresh_token: bool,
}

#[derive(Serialize)]
struct LoginParams<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none", rename = "apiKey")]
    api_key: Option<&'a str>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "useHostedLoginSuccessPage"
    )]
    hosted_success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "appBrand")]
    app_brand: Option<&'a str>,
}

pub async fn list_provider_models(
    connection: &AppServerConnection,
) -> Result<Value, ConnectionError> {
    let config = read_config(connection).await?;
    if provider_mode(&config) == "custom"
        && let Some(models) = config.pointer("/desktop/codeagent/provider/customModels")
        && valid_model_page(models)
    {
        return Ok(models.clone());
    }
    list_models(connection).await
}

pub async fn get_provider_connection(
    connection: &AppServerConnection,
    pending_login: Option<Value>,
) -> Result<Value, ConnectionError> {
    let config = read_config(connection).await?;
    let response: Value = connection
        .request(
            "account/read",
            &AccountReadParams {
                refresh_token: false,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let account = response.get("account").and_then(map_account);
    let mode = provider_mode(&config);
    let state = if let Some(pending) = pending_login.as_ref() {
        pending
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("pending")
    } else if account.is_some() {
        "connected"
    } else {
        "disconnected"
    };
    Ok(json!({
        "account": account,
        "customBaseUrl": custom_base_url(&config),
        "mode": mode,
        "pendingLogin": pending_login,
        "state": state,
    }))
}

pub async fn start_official_provider_login(
    connection: &AppServerConnection,
) -> Result<Value, ConnectionError> {
    write_config(
        connection,
        vec![
            edit("model_provider", json!("openai")),
            edit("desktop.codeagent.provider.mode", json!("official")),
        ],
    )
    .await?;
    let response: Value = connection
        .request(
            "account/login/start",
            &LoginParams {
                kind: "chatgpt",
                api_key: None,
                hosted_success: Some(true),
                app_brand: Some("codex"),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let login_id = response
        .get("loginId")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    let auth_url = response
        .get("authUrl")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    let status = disconnected_status("official", None, Some(pending(login_id, None)));
    Ok(json!({"authUrl": auth_url, "loginId": login_id, "status": status}))
}

pub async fn cancel_provider_login(
    connection: &AppServerConnection,
    login_id: &str,
) -> Result<Value, ConnectionError> {
    if login_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let _: Value = connection
        .request(
            "account/login/cancel",
            &json!({"loginId": login_id}),
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(json!({"status": disconnected_status("official", None, None)}))
}

pub async fn logout_provider(connection: &AppServerConnection) -> Result<Value, ConnectionError> {
    let _: Value = connection
        .request(
            "account/logout",
            &serde_json::Map::<String, Value>::new(),
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(json!({"status": disconnected_status("official", None, None)}))
}

pub async fn configure_custom_provider(
    connection: &AppServerConnection,
    input: Value,
) -> Result<Value, ConnectionError> {
    let base_url = input
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| {
            (value.starts_with("https://") || value.starts_with("http://"))
                && value.len() <= 2_048
                && !value.chars().any(char::is_whitespace)
        })
        .ok_or(ConnectionError::InvalidMessage)?;
    let models = map_custom_models(input.get("models"))?;
    let provider = json!({
        "name": "CodeAgent Custom",
        "base_url": base_url,
        "wire_api": "responses",
        "requires_openai_auth": true,
    });
    let private = json!({
        "mode": "custom",
        "customBaseUrl": base_url,
        "customModels": models,
    });
    write_config(
        connection,
        vec![
            edit(&format!("model_providers.{CUSTOM_PROVIDER_ID}"), provider),
            edit("model_provider", json!(CUSTOM_PROVIDER_ID)),
            edit("desktop.codeagent.provider", private),
        ],
    )
    .await?;

    if let Some(api_key) = input.get("apiKey").and_then(Value::as_str) {
        if api_key.is_empty() || api_key.len() > 16_384 {
            return Err(ConnectionError::InvalidMessage);
        }
        let _: Value = connection
            .request(
                "account/login/start",
                &LoginParams {
                    kind: "apiKey",
                    api_key: Some(api_key),
                    hosted_success: None,
                    app_brand: None,
                },
                REQUEST_TIMEOUT,
            )
            .await?;
    }

    Ok(json!({
        "models": models,
        "status": {
            "account": {"type": "apiKey"}, "customBaseUrl": base_url, "mode": "custom",
            "pendingLogin": null, "state": "connected"
        }
    }))
}

fn map_custom_models(value: Option<&Value>) -> Result<Value, ConnectionError> {
    let values = match value {
        None => Vec::new(),
        Some(Value::Array(values)) if values.len() <= 1_000 => values.clone(),
        _ => return Err(ConnectionError::InvalidMessage),
    };
    let mut ids = HashSet::new();
    let mut data = Vec::with_capacity(values.len());
    for (index, model) in values.iter().enumerate() {
        let id = model.get("id").and_then(Value::as_str).map(str::trim);
        let name = model.get("name").and_then(Value::as_str).map(str::trim);
        let (Some(id), Some(name)) = (id, name) else {
            return Err(ConnectionError::InvalidMessage);
        };
        if id.is_empty() || name.is_empty() || id.len() > 256 || name.len() > 256 || !ids.insert(id)
        {
            return Err(ConnectionError::InvalidMessage);
        }
        data.push(json!({
            "defaultReasoningEffort": "medium", "description": "Custom provider model",
            "displayName": name, "id": id, "isDefault": index == 0,
            "supportedReasoningEfforts": [
                {"description": "Low", "id": "low"},
                {"description": "Medium", "id": "medium"},
                {"description": "High", "id": "high"}
            ]
        }));
    }
    Ok(json!({"data": data, "nextCursor": null}))
}

fn provider_mode(config: &Value) -> &'static str {
    if config.get("model_provider").and_then(Value::as_str) == Some(CUSTOM_PROVIDER_ID) {
        "custom"
    } else {
        "official"
    }
}

fn custom_base_url(config: &Value) -> Value {
    config
        .pointer("/desktop/codeagent/provider/customBaseUrl")
        .cloned()
        .or_else(|| {
            config
                .pointer(&format!("/model_providers/{CUSTOM_PROVIDER_ID}/base_url"))
                .cloned()
        })
        .unwrap_or(Value::Null)
}

fn map_account(account: &Value) -> Option<Value> {
    match account.get("type").and_then(Value::as_str)? {
        "apiKey" => Some(json!({"type": "apiKey"})),
        "chatgpt" => Some(json!({
            "email": account.get("email").cloned().unwrap_or(Value::Null),
            "planType": account.get("planType").cloned().unwrap_or(Value::Null),
            "type": "chatgpt"
        })),
        _ => None,
    }
}

fn pending(login_id: &str, error: Option<&str>) -> Value {
    json!({"error": error, "loginId": login_id, "state": if error.is_some() { "failed" } else { "pending" }})
}

fn disconnected_status(mode: &str, custom_base_url: Option<&str>, pending: Option<Value>) -> Value {
    let state = pending
        .as_ref()
        .and_then(|value| value.get("state"))
        .and_then(Value::as_str)
        .unwrap_or("disconnected");
    json!({
        "account": null, "customBaseUrl": custom_base_url, "mode": mode,
        "pendingLogin": pending, "state": state
    })
}

fn valid_model_page(value: &Value) -> bool {
    value.get("data").is_some_and(Value::is_array)
        && matches!(
            value.get("nextCursor"),
            Some(Value::Null) | Some(Value::String(_))
        )
}
