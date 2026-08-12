use std::{str::FromStr, sync::Arc};

use code_agent_protocol::ProjectId;
use code_agent_runtime::CodeAgentRuntime;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::command_error::CommandError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceQuery {
    cursor: Option<u64>,
    path: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectRequest {
    app_id: String,
    path: Option<String>,
}

#[tauri::command]
pub async fn file_source_read(
    request_id: String,
    project_id: String,
    query: SourceQuery,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    let project_id = parse_project_id(project_id)?;
    runtime
        .source_file(
            &request_id,
            &project_id,
            &query.path,
            query.cursor.unwrap_or(0),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn file_tree(
    request_id: String,
    project_id: String,
    directory_path: Option<String>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    let project_id = parse_project_id(project_id)?;
    runtime
        .file_tree(&request_id, &project_id, directory_path.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn file_search(
    request_id: String,
    project_id: String,
    query: SearchQuery,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    let project_id = parse_project_id(project_id)?;
    runtime
        .file_search(&request_id, &project_id, &query.query)
        .await
        .map_err(Into::into)
}

fn parse_project_id(value: String) -> Result<ProjectId, CommandError> {
    ProjectId::from_str(&value).map_err(|_| CommandError {
        code: "invalid_input".to_owned(),
        message: "projectId must not be empty".to_owned(),
        retryable: false,
    })
}

#[tauri::command]
pub async fn project_directories_list(
    request_id: String,
    path: Option<String>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .project_directories(&request_id, path.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn host_files_list(
    request_id: String,
    kind: String,
    path: Option<String>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .host_files(&request_id, &kind, path.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn project_open_capabilities(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .project_open_capabilities(&request_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn project_open(
    request_id: String,
    project_id: String,
    request: OpenProjectRequest,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    let project_id = parse_project_id(project_id)?;
    runtime
        .open_project_path(
            &request_id,
            &project_id,
            &request.app_id,
            request.path.as_deref(),
        )
        .await
        .map_err(Into::into)
}
