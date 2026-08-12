use std::time::Duration;

use code_agent_core::CodeAgentError;
use reqwest::{Client, Url, redirect::Policy};
use serde_json::{Value, json};

const MAX_MODELS: usize = 1_000;
const MAX_MODELS_RESPONSE_BYTES: usize = 1_048_576;

fn normalize_base_url(value: &str) -> Result<Url, CodeAgentError> {
    let mut url = Url::parse(value)
        .map_err(|_| CodeAgentError::internal("custom provider baseUrl is invalid"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err(CodeAgentError::internal(
            "custom provider baseUrl is invalid",
        ));
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url)
}

/// 从 OpenAI 兼容 `/models` 端点读取有界模型目录，不跟随重定向。
pub(crate) async fn discover_models(
    base_url: &str,
    api_key: Option<&str>,
) -> Result<(String, Vec<Value>), CodeAgentError> {
    let base_url = normalize_base_url(base_url)?;
    let mut endpoint = base_url.clone();
    endpoint.set_path(&format!("{}/models", base_url.path().trim_end_matches('/')));
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .build()
        .map_err(|_| CodeAgentError::internal("custom provider HTTP client is unavailable"))?;
    let mut request = client.get(endpoint);
    if let Some(api_key) = api_key {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| CodeAgentError::internal("custom provider model discovery failed"))?;
    if response.status().is_redirection() || !response.status().is_success() {
        return Err(CodeAgentError::internal(
            "custom provider model discovery failed",
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODELS_RESPONSE_BYTES as u64)
    {
        return Err(CodeAgentError::internal(
            "custom provider model response is too large",
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| CodeAgentError::internal("custom provider model response is invalid"))?;
    if bytes.len() > MAX_MODELS_RESPONSE_BYTES {
        return Err(CodeAgentError::internal(
            "custom provider model response is too large",
        ));
    }
    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| CodeAgentError::internal("custom provider model response is invalid"))?;
    let models = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| CodeAgentError::internal("custom provider model response is invalid"))?;
    if models.len() > MAX_MODELS {
        return Err(CodeAgentError::internal(
            "custom provider model response has too many entries",
        ));
    }
    let mapped = models
        .iter()
        .filter_map(|model| model.get("id").and_then(Value::as_str))
        .filter(|id| !id.trim().is_empty())
        .map(map_model)
        .collect();
    Ok((
        base_url.to_string().trim_end_matches('/').to_string(),
        mapped,
    ))
}

pub(crate) fn map_model(id: &str) -> Value {
    json!({
        "defaultReasoningEffort": "medium",
        "description": "",
        "displayName": id,
        "id": id,
        "isDefault": false,
        "supportedReasoningEfforts": [
            { "description": "", "id": "low" },
            { "description": "", "id": "medium" },
            { "description": "", "id": "high" }
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_base_url;

    #[test]
    fn base_url_should_accept_http_and_https_without_unsafe_components() {
        assert_eq!(
            normalize_base_url("https://example.com/v1/")
                .expect("valid URL")
                .as_str(),
            "https://example.com/v1"
        );
        assert!(normalize_base_url("http://127.0.0.1:8080/v1").is_ok());
    }

    #[test]
    fn base_url_should_reject_credentials_query_fragment_and_other_schemes() {
        for value in [
            "ftp://example.com/v1",
            "https://user:secret@example.com/v1",
            "https://example.com/v1?token=secret",
            "https://example.com/v1#models",
        ] {
            assert!(normalize_base_url(value).is_err(), "{value}");
        }
    }
}
