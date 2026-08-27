use serde_json::Value;
use tauri::State;

use super::{error::AppError, state::AppState};
use crate::infrastructure::codex;

fn request_error(_: impl std::fmt::Debug) -> AppError {
    AppError::CodexRequestFailed
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::list_provider_models(&connection)
        .await
        .map_err(request_error)
}

#[tauri::command]
pub async fn get_provider_connection(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::get_provider_connection(&connection, state.provider_login().await)
        .await
        .map_err(request_error)
}

#[tauri::command]
pub async fn start_official_provider_login(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::start_official_provider_login(&connection)
        .await
        .map_err(request_error)?;
    state
        .set_provider_login(response.pointer("/status/pendingLogin").cloned())
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_provider_login(
    login_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::cancel_provider_login(&connection, &login_id)
        .await
        .map_err(request_error)?;
    state.set_provider_login(None).await;
    Ok(response)
}

#[tauri::command]
pub async fn logout_provider(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::logout_provider(&connection)
        .await
        .map_err(request_error)?;
    state.set_provider_login(None).await;
    Ok(response)
}

#[tauri::command]
pub async fn configure_custom_provider(
    input: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::configure_custom_provider(&connection, input)
        .await
        .map_err(request_error)?;
    state.set_provider_login(None).await;
    Ok(response)
}

#[tauri::command]
pub async fn get_global_settings(state: State<'_, AppState>) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::get_global_settings(&connection)
        .await
        .map_err(request_error)
}

#[tauri::command]
pub async fn update_global_settings(
    settings: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::update_global_settings(&connection, settings)
        .await
        .map_err(request_error)
}

async fn validate_project(
    state: &State<'_, AppState>,
    project_id: &str,
) -> Result<
    (
        std::sync::Arc<codex::AppServerConnection>,
        crate::domain::sidebar::Project,
    ),
    AppError,
> {
    let connection = state.codex_connection().await?;
    let project = codex::read_project(&connection, project_id)
        .await
        .map_err(request_error)?;
    Ok((connection, project))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_defaults(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, _) = validate_project(&state, &project_id).await?;
    codex::get_project_defaults(&connection, &project_id)
        .await
        .map_err(request_error)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_project_defaults(
    project_id: String,
    settings: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, _) = validate_project(&state, &project_id).await?;
    codex::update_project_defaults(&connection, &project_id, settings)
        .await
        .map_err(request_error)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_skills(
    project_id: String,
    force_reload: bool,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let (connection, project) = validate_project(&state, &project_id).await?;
    let cwd = project
        .roots
        .first()
        .map(|root| root.path.as_str())
        .ok_or(AppError::CodexRequestFailed)?;
    codex::list_skills(&connection, cwd, force_reload)
        .await
        .map_err(request_error)
}

async fn validate_task(
    connection: &codex::AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    codex::read_task(connection, project_id.to_owned(), task_id.to_owned())
        .await
        .map(|_| ())
        .map_err(request_error)
}

async fn mcp_servers_with_status(
    state: &State<'_, AppState>,
    task_id: &str,
    mut response: Value,
) -> Value {
    let statuses = state.mcp_statuses(task_id).await;
    if let Some(servers) = response.get_mut("data").and_then(Value::as_array_mut) {
        for server in servers {
            let name = server.get("name").and_then(Value::as_str);
            let Some(status) = statuses
                .iter()
                .rev()
                .find(|status| status.get("name").and_then(Value::as_str) == name)
            else {
                continue;
            };
            server["status"] = status["status"].clone();
            server["error"] = status.get("error").cloned().unwrap_or(Value::Null);
            server["failureReason"] = status.get("failureReason").cloned().unwrap_or(Value::Null);
        }
    }
    response
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_mcp_servers(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    validate_task(&connection, &project_id, &task_id).await?;
    let response = codex::list_mcp_servers(&connection, &task_id)
        .await
        .map_err(request_error)?;
    Ok(mcp_servers_with_status(&state, &task_id, response).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn retry_mcp_servers(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    validate_task(&connection, &project_id, &task_id).await?;
    let response = codex::reload_mcp_servers(&connection, &task_id)
        .await
        .map_err(request_error)?;
    Ok(mcp_servers_with_status(&state, &task_id, response).await)
}
