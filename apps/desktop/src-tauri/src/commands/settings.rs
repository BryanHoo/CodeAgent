use std::{str::FromStr, sync::Arc};

use code_agent_protocol::{
    AgentGlobalSettings, AgentProjectDefaults, AgentTaskSettings, ProjectId, TaskId,
};
use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use tauri::State;

use crate::command_error::CommandError;

#[derive(Debug, Serialize)]
pub struct GlobalSettingsResponse {
    settings: AgentGlobalSettings,
}

#[derive(Debug, Serialize)]
pub struct ProjectDefaultsResponse {
    settings: AgentProjectDefaults,
}

#[derive(Debug, Serialize)]
pub struct TaskSettingsResponse {
    settings: AgentTaskSettings,
}

#[tauri::command]
pub async fn global_settings_get(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<GlobalSettingsResponse, CommandError> {
    let settings = runtime.effective_global_settings(&request_id).await?;
    Ok(GlobalSettingsResponse { settings })
}

#[tauri::command]
pub async fn global_settings_update(
    request_id: String,
    settings: AgentGlobalSettings,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<GlobalSettingsResponse, CommandError> {
    let settings = runtime
        .update_global_settings(&request_id, &settings)
        .await?;
    Ok(GlobalSettingsResponse { settings })
}

#[tauri::command]
pub async fn project_defaults_get(
    request_id: String,
    project_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProjectDefaultsResponse, CommandError> {
    let project_id = parse_project_id(project_id)?;
    let settings = runtime
        .effective_project_defaults(&request_id, &project_id)
        .await?;
    Ok(ProjectDefaultsResponse { settings })
}

#[tauri::command]
pub async fn project_defaults_update(
    request_id: String,
    project_id: String,
    settings: AgentProjectDefaults,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProjectDefaultsResponse, CommandError> {
    let project_id = parse_project_id(project_id)?;
    let settings = runtime
        .update_project_defaults(&request_id, &project_id, &settings)
        .await?;
    Ok(ProjectDefaultsResponse { settings })
}

#[tauri::command]
pub async fn task_settings_get(
    request_id: String,
    project_id: String,
    task_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskSettingsResponse, CommandError> {
    let project_id = parse_project_id(project_id)?;
    let task_id = parse_task_id(task_id)?;
    let settings = runtime
        .task_settings(&request_id, &project_id, &task_id)
        .await?
        .ok_or_else(settings_not_initialized)?;
    Ok(TaskSettingsResponse { settings })
}

#[tauri::command]
pub async fn task_settings_update(
    request_id: String,
    project_id: String,
    task_id: String,
    settings: AgentTaskSettings,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<TaskSettingsResponse, CommandError> {
    let project_id = parse_project_id(project_id)?;
    let task_id = parse_task_id(task_id)?;
    let settings = runtime
        .update_task_settings(&request_id, &project_id, &task_id, &settings)
        .await?;
    Ok(TaskSettingsResponse { settings })
}

fn parse_project_id(value: String) -> Result<ProjectId, CommandError> {
    ProjectId::from_str(&value).map_err(|_| invalid_id("projectId"))
}

fn parse_task_id(value: String) -> Result<TaskId, CommandError> {
    TaskId::from_str(&value).map_err(|_| invalid_id("taskId"))
}

fn invalid_id(name: &str) -> CommandError {
    CommandError::invalid_input(format!("{name} must not be empty"))
}

fn settings_not_initialized() -> CommandError {
    CommandError::not_found("settings are not initialized")
}
