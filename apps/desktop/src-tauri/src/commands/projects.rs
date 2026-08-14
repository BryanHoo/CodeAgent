use std::{path::Path, str::FromStr, sync::Arc};

use code_agent_protocol::{Project, ProjectId};
use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use tauri::State;

use crate::command_error::CommandError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPageResponse {
    data: Vec<Project>,
    next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProjectResponse {
    project: Project,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectResponse {
    project_id: ProjectId,
    status: &'static str,
}

#[tauri::command]
pub async fn project_list(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProjectPageResponse, CommandError> {
    let projects = runtime.list_projects(&request_id).await?;
    Ok(project_page(projects))
}

#[tauri::command]
pub async fn project_add(
    request_id: String,
    idempotency_key: String,
    root_path: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProjectResponse, CommandError> {
    let name = Path::new(&root_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&root_path);
    let project = runtime
        .register_project(&request_id, &idempotency_key, &root_path, name)
        .await?;
    Ok(ProjectResponse { project })
}

#[tauri::command]
pub async fn project_reorder(
    request_id: String,
    idempotency_key: String,
    project_ids: Vec<String>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProjectPageResponse, CommandError> {
    let project_ids = parse_project_ids(project_ids)?;
    let projects = runtime
        .reorder_projects(&request_id, &idempotency_key, &project_ids)
        .await?;
    Ok(project_page(projects))
}

#[tauri::command]
pub async fn project_rename(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    name: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProjectResponse, CommandError> {
    let project_id = parse_project_id(project_id)?;
    let project = runtime
        .rename_project(&request_id, &idempotency_key, &project_id, &name)
        .await?;
    Ok(ProjectResponse { project })
}

#[tauri::command]
pub async fn project_remove(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<RemoveProjectResponse, CommandError> {
    let project_id = parse_project_id(project_id)?;
    runtime
        .remove_project(&request_id, &idempotency_key, &project_id)
        .await?;
    Ok(RemoveProjectResponse {
        project_id,
        status: "removed",
    })
}

fn project_page(data: Vec<Project>) -> ProjectPageResponse {
    ProjectPageResponse {
        data,
        next_cursor: None,
    }
}

fn parse_project_ids(values: Vec<String>) -> Result<Vec<ProjectId>, CommandError> {
    values.into_iter().map(parse_project_id).collect()
}

fn parse_project_id(value: String) -> Result<ProjectId, CommandError> {
    ProjectId::from_str(&value).map_err(|_| CommandError::invalid_input("invalid project id"))
}
