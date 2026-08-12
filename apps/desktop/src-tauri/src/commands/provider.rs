use std::sync::Arc;

use code_agent_runtime::CodeAgentRuntime;
use serde_json::Value;
use tauri::State;

use crate::{command_error::CommandError, commands::tasks::project};

#[tauri::command]
pub async fn capabilities_get(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    serde_json::to_value(runtime.capabilities(&request_id).await?)
        .map_err(|error| internal(error.to_string()))
}

#[tauri::command]
pub async fn models_list(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    serde_json::to_value(runtime.models(&request_id).await?)
        .map_err(|error| internal(error.to_string()))
}

#[tauri::command]
pub async fn skills_list(
    request_id: String,
    project_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    serde_json::to_value(
        runtime
            .agent_skills(&request_id, &project(&project_id)?)
            .await?,
    )
    .map_err(|error| internal(error.to_string()))
}

#[tauri::command]
pub async fn provider_connection_get(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .provider_connection_status(&request_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn provider_login_start(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .start_provider_login(&request_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn provider_login_cancel(
    request_id: String,
    login_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .cancel_provider_login(&request_id, &login_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn provider_logout(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .logout_provider(&request_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn provider_custom_configure(
    request_id: String,
    input: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .configure_custom_provider(&request_id, input)
        .await
        .map_err(Into::into)
}

fn internal(message: String) -> CommandError {
    CommandError {
        code: "internal".to_owned(),
        message,
        retryable: false,
    }
}
