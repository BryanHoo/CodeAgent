use chrono::{DateTime, Utc};
use code_agent_core::{CodeAgentError, PortRequestContext};
use code_agent_protocol::{
    AgentModelPage, AgentProviderConnectionRecord, AgentProviderConnectionRecordMode,
};
use serde_json::{Value, json};

use crate::CodeAgentRuntime;

pub(crate) fn official_record(
    updated_at: DateTime<Utc>,
) -> Result<AgentProviderConnectionRecord, CodeAgentError> {
    parse_record(json!({
        "customBaseUrl": null,
        "customModels": null,
        "mode": "official",
        "updatedAt": updated_at,
    }))
}

pub(crate) fn custom_record(
    response: &Value,
    updated_at: DateTime<Utc>,
) -> Result<AgentProviderConnectionRecord, CodeAgentError> {
    parse_record(json!({
        "customBaseUrl": response.pointer("/status/customBaseUrl"),
        "customModels": response.get("models"),
        "mode": "custom",
        "updatedAt": updated_at,
    }))
}

fn parse_record(value: Value) -> Result<AgentProviderConnectionRecord, CodeAgentError> {
    serde_json::from_value(value).map_err(|error| CodeAgentError::internal(error.to_string()))
}

/// 仅当当前 Codex 连接仍指向同一自定义地址时，才使用保存的模型目录。
pub(crate) fn matching_custom_models(
    active: &Value,
    stored: Option<AgentProviderConnectionRecord>,
) -> Result<Option<AgentModelPage>, CodeAgentError> {
    if active.get("mode").and_then(Value::as_str) != Some("custom") {
        return Ok(None);
    }
    let Some(stored) = stored.filter(|record| {
        record.mode == AgentProviderConnectionRecordMode::Custom
            && record.custom_base_url.as_ref().map(|url| url.as_str())
                == active.get("customBaseUrl").and_then(Value::as_str)
    }) else {
        return Ok(None);
    };
    let models = stored
        .custom_models
        .ok_or_else(|| CodeAgentError::internal("custom provider model catalog is unavailable"))?;
    serde_json::from_value(
        serde_json::to_value(models)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?,
    )
    .map(Some)
    .map_err(|error| CodeAgentError::internal(error.to_string()))
}

impl CodeAgentRuntime {
    pub(crate) async fn persisted_models(
        &self,
        context: &PortRequestContext,
    ) -> Result<Option<AgentModelPage>, CodeAgentError> {
        let (active, stored) = tokio::try_join!(
            self.ports.provider.connection_status(context),
            self.ports.repository.read_provider_connection(context),
        )?;
        matching_custom_models(&active, stored)
    }
}
