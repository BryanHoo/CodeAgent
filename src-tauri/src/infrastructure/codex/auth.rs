use std::{collections::HashSet, path::Path, time::Duration};

use serde::Serialize;
use serde_json::{Value, json};
use thiserror::Error;

use crate::infrastructure::provider_models::{
    ProviderModelsError, read_provider_models, write_provider_models,
};

use super::{
    catalogs::list_models,
    config::{edit, read_config, write_config},
    connection::{AppServerConnection, ConnectionError},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_CUSTOM_PROVIDER_ID: &str = "OpenAI";

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error(transparent)]
    Connection(#[from] ConnectionError),
    #[error("failed to access local provider models")]
    Storage,
}

impl From<ProviderModelsError> for ProviderError {
    fn from(_: ProviderModelsError) -> Self {
        Self::Storage
    }
}

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
    app_data: &Path,
) -> Result<Value, ProviderError> {
    let config = read_config(connection).await?;
    if provider_mode(&config) == "custom" {
        let provider_id = selected_provider_id(&config);
        if let Some(base_url) = configured_custom_base_url(&config)
            && let Some(models) = read_provider_models(app_data, provider_id, base_url)
                .await?
                .or_else(|| legacy_provider_models(&config, base_url))
        {
            return Ok(models);
        }
    }
    Ok(list_models(connection).await?)
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
    let requires_openai_auth = response
        .get("requiresOpenaiAuth")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mode = provider_mode(&config);
    let state = if let Some(pending) = pending_login.as_ref() {
        pending
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("pending")
    // Codex 151 中无需 OpenAI 认证的 provider 即使没有 account 也已可用。
    } else if account.is_some() || !requires_openai_auth {
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
            edit("desktop.codeagent.provider", Value::Null),
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
    app_data: &Path,
    input: Value,
) -> Result<Value, ProviderError> {
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
    let config = read_config(connection).await?;
    let existing_custom_provider_id = (provider_mode(&config) == "custom")
        .then(|| configured_provider_id(&config))
        .flatten();
    let provider_id = existing_custom_provider_id.unwrap_or(DEFAULT_CUSTOM_PROVIDER_ID);
    let submitted_models = match input.get("models") {
        Some(models) => map_custom_models(Some(models))?,
        None => empty_model_page(),
    };
    let models = if model_page_has_data(&submitted_models) {
        submitted_models
    } else {
        read_provider_models(app_data, provider_id, base_url)
            .await?
            .or_else(|| legacy_provider_models(&config, base_url))
            .unwrap_or_else(empty_model_page)
    };
    // 先保存可恢复目录，再清理旧 TOML，避免迁移过程中丢失用户模型。
    if model_page_has_data(&models) {
        write_provider_models(app_data, provider_id, base_url, &models).await?;
    }
    let mut edits = if provider_id == "openai" {
        vec![edit("openai_base_url", json!(base_url))]
    } else {
        let provider_name = config
            .get("model_providers")
            .and_then(Value::as_object)
            .and_then(|providers| providers.get(provider_id))
            .and_then(|provider| provider.get("name"))
            .and_then(non_empty_string)
            .unwrap_or(provider_id);
        let provider = json!({
            "name": provider_name,
            "base_url": base_url,
            "wire_api": "responses",
            "requires_openai_auth": true,
        });
        vec![edit(&format!("model_providers.{provider_id}"), provider)]
    };
    edits.push(edit("desktop.codeagent.provider", Value::Null));
    if existing_custom_provider_id.is_none() {
        edits.push(edit("model_provider", json!(DEFAULT_CUSTOM_PROVIDER_ID)));
    }
    write_config(connection, edits).await?;

    if let Some(api_key) = input.get("apiKey").and_then(Value::as_str) {
        if api_key.is_empty() || api_key.len() > 16_384 {
            return Err(ConnectionError::InvalidMessage.into());
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

fn empty_model_page() -> Value {
    json!({"data": [], "nextCursor": null})
}

fn model_page_has_data(models: &Value) -> bool {
    models
        .get("data")
        .and_then(Value::as_array)
        .is_some_and(|data| !data.is_empty())
}

fn legacy_provider_models(config: &Value, base_url: &str) -> Option<Value> {
    let private = config.pointer("/desktop/codeagent/provider")?;
    if private.get("customBaseUrl").and_then(Value::as_str) != Some(base_url) {
        return None;
    }
    let data = private
        .get("customModels")
        .and_then(Value::as_array)
        .filter(|data| !data.is_empty())?
        .clone();
    Some(json!({"data": data, "nextCursor": null}))
}

fn selected_provider_id(config: &Value) -> &str {
    configured_provider_id(config).unwrap_or("openai")
}

fn configured_provider_id(config: &Value) -> Option<&str> {
    config.get("model_provider").and_then(non_empty_string)
}

fn provider_mode(config: &Value) -> &'static str {
    // Codex 151 以 model_provider 选择服务，openai_base_url 会改写内置 OpenAI 端点。
    if selected_provider_id(config) != "openai" || configured_openai_base_url(config).is_some() {
        "custom"
    } else {
        "official"
    }
}

fn custom_base_url(config: &Value) -> Value {
    configured_custom_base_url(config)
        .map(str::to_owned)
        .map(Value::String)
        .unwrap_or(Value::Null)
}

fn configured_custom_base_url(config: &Value) -> Option<&str> {
    let provider_id = selected_provider_id(config);
    if provider_id == "openai" {
        return configured_openai_base_url(config);
    }
    config
        .get("model_providers")
        .and_then(Value::as_object)
        .and_then(|providers| providers.get(provider_id))
        .and_then(|provider| provider.get("base_url"))
        .and_then(non_empty_string)
}

fn configured_openai_base_url(config: &Value) -> Option<&str> {
    config.get("openai_base_url").and_then(non_empty_string)
}

fn non_empty_string(value: &Value) -> Option<&str> {
    value.as_str().filter(|value| !value.trim().is_empty())
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
