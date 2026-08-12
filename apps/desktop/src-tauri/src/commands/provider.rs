use std::sync::Arc;

use code_agent_protocol::AgentProviderConnectionRecordMode;
use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use tauri::State;

use crate::command_error::CommandError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionStatusResponse {
    account: Option<()>,
    custom_base_url: Option<String>,
    mode: AgentProviderConnectionRecordMode,
    pending_login: Option<()>,
    state: &'static str,
}

#[tauri::command]
pub async fn provider_connection_get(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProviderConnectionStatusResponse, CommandError> {
    let record = runtime.provider_connection_record(&request_id).await?;
    let Some(record) = record else {
        return Ok(ProviderConnectionStatusResponse {
            account: None,
            custom_base_url: None,
            mode: AgentProviderConnectionRecordMode::Official,
            pending_login: None,
            state: "disconnected",
        });
    };
    Ok(ProviderConnectionStatusResponse {
        account: None,
        custom_base_url: record.custom_base_url.map(Into::into),
        mode: record.mode,
        pending_login: None,
        state: "disconnected",
    })
}
