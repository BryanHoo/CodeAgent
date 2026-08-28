use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};
use tokio::time::timeout;

use super::{error::AppError, state::AppState};
use crate::{
    domain::conversation::{
        AgentPromptInput, AgentTaskSettings, AgentTaskSnapshotResponse, AgentTurnActionResponse,
        AgentTurnOptions,
    },
    domain::sidebar::{
        AgentTaskMutationResponse, AgentTaskPage, AgentTaskStatusResponse, ListTasksInput,
        ProjectDirectoryListing, ProjectMutationResponse, ProjectPage, RemoveProjectResponse,
    },
    infrastructure::{
        codex,
        filesystem::list_project_directories as read_project_directories,
        task_settings::{
            delete_project_task_settings, delete_task_settings, read_task_settings,
            write_task_settings,
        },
    },
};

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<ProjectPage, AppError> {
    let connection = state.codex_connection().await?;
    codex::list_projects(&connection)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_project(
    root_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::add_project(&connection, root_paths)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_project(
    project_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<ProjectMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::rename_project(&connection, project_id, name)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn remove_project(
    app: AppHandle,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<RemoveProjectResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::remove_project(&connection, project_id.clone())
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    delete_project_task_settings(&app_data_dir(&app)?, &project_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_projects(
    project_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ProjectPage, AppError> {
    let connection = state.codex_connection().await?;
    codex::reorder_projects(&connection, project_ids)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_project_directories(
    app: AppHandle,
    path: Option<String>,
    include_hidden: bool,
) -> Result<ProjectDirectoryListing, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::HomeDirectoryUnavailable)?;
    read_project_directories(&home, path.as_deref(), include_hidden)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command]
pub async fn list_tasks(
    input: ListTasksInput,
    state: State<'_, AppState>,
) -> Result<AgentTaskPage, AppError> {
    let connection = state.codex_connection().await?;
    let project_id = input.project_id.clone();
    let response = codex::list_tasks(&connection, input)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    state
        .remember_tasks(
            &project_id,
            response.data.iter().map(|task| task.id.as_str()),
        )
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    cursor: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskSnapshotResponse, AppError> {
    let connection = state.codex_connection().await?;
    state.remember_tasks(&project_id, [task_id.as_str()]).await;
    let mut response = codex::read_task_snapshot(
        &connection,
        project_id.clone(),
        task_id.clone(),
        cursor.as_deref(),
    )
    .await
    .map_err(|_| AppError::CodexRequestFailed)?;
    response.snapshot.settings =
        effective_task_settings(&app, &connection, &project_id, &task_id).await?;
    response.checkpoint.sequence = state.project_sequence(&project_id).await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_task(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::start_task(&connection, project_id.clone())
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    state
        .remember_tasks(&project_id, [response.task.id.as_str()])
        .await;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_turn(
    app: AppHandle,
    project_id: String,
    task_id: String,
    mut input: AgentPromptInput,
    options: AgentTurnOptions,
    resume_task: bool,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    super::attachment_commands::resolve_prompt_attachments(&app_data, &project_id, &mut input)
        .await?;
    let connection = state.codex_connection().await?;
    // App Server 可能先推送 turn/started，再返回 turn/start 响应，必须提前建立归属。
    state.remember_tasks(&project_id, [task_id.as_str()]).await;
    let settings = AgentTaskSettings::from(&options);
    write_task_settings(&app_data, &project_id, &task_id, &settings)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if options.goal_mode {
        if !input.attachments.is_empty() || !input.skills.is_empty() {
            return Err(AppError::CodexRequestFailed);
        }
        if resume_task {
            codex::resume_task(&connection, &project_id, &task_id)
                .await
                .map_err(AppError::from)?;
        }
        let (waiter_id, turn_started) = state.register_turn_started(&task_id).await;
        let result = async {
            codex::update_thread_settings(&connection, &task_id, &options)
                .await
                .map_err(|_| AppError::CodexRequestFailed)?;
            codex::set_goal_objective(&connection, &task_id, &input.text)
                .await
                .map_err(|_| AppError::CodexRequestFailed)?;
            timeout(Duration::from_secs(30), turn_started)
                .await
                .map_err(|_| AppError::CodexRequestFailed)?
                .map_err(|_| AppError::CodexRequestFailed)
        }
        .await;
        let turn = match result {
            Ok(turn) => turn,
            Err(error) => {
                state.cancel_turn_started(&task_id, waiter_id).await;
                return Err(error);
            }
        };
        return Ok(json!({
            "checkpoint": {
                "sequence": state.project_sequence(&project_id).await,
                "sessionId": codex::RUNTIME_SESSION_ID,
            },
            "taskId": task_id,
            "turn": turn,
        }));
    }
    let mut response = codex::start_turn(
        &connection,
        project_id.clone(),
        task_id,
        input,
        options,
        resume_task,
    )
    .await
    .map_err(AppError::from)?;
    response.checkpoint.sequence = state.project_sequence(&project_id).await;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_task_settings(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    Ok(json!({
        "settings": effective_task_settings(&app, &connection, &project_id, &task_id).await?,
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_task_settings(
    app: AppHandle,
    project_id: String,
    task_id: String,
    settings: AgentTaskSettings,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    if !settings.is_valid() {
        return Err(AppError::CodexRequestFailed);
    }
    let connection = state.codex_connection().await?;
    codex::read_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    write_task_settings(&app_data_dir(&app)?, &project_id, &task_id, &settings)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(json!({"settings": settings}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn steer_turn(
    app: AppHandle,
    project_id: String,
    task_id: String,
    turn_id: String,
    mut input: AgentPromptInput,
    state: State<'_, AppState>,
) -> Result<AgentTurnActionResponse, AppError> {
    super::attachment_commands::resolve_prompt_attachments(
        &app_data_dir(&app)?,
        &project_id,
        &mut input,
    )
    .await?;
    let connection = state.codex_connection().await?;
    codex::steer_turn(&connection, task_id, turn_id, input)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn interrupt_turn(
    task_id: String,
    turn_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTurnActionResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::interrupt_turn(&connection, task_id, turn_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn resolve_pending_request(
    request_id: String,
    resolution: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let pending = state
        .take_pending_request(&request_id)
        .await
        .ok_or(AppError::CodexRequestFailed)?;
    let result = match codex::response_for_resolution(&pending, &resolution) {
        Ok(result) => result,
        Err(_) => {
            state.restore_pending_request(pending).await;
            return Err(AppError::CodexRequestFailed);
        }
    };
    if connection.respond(pending.rpc_id, &result).await.is_err() {
        state.restore_pending_request(pending).await;
        return Err(AppError::CodexRequestFailed);
    }
    let request = state.publish_resolved_request(&pending).await?;
    Ok(json!({"request": request}))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_review(
    project_id: String,
    task_id: String,
    input: Value,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let target = input.get("target").ok_or(AppError::CodexRequestFailed)?;
    let response = codex::start_review(&connection, &project_id, &task_id, target)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn compact_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Value, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::compact_task(&connection, &project_id, &task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fork_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    last_turn_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    let settings = effective_task_settings(&app, &connection, &project_id, &task_id).await?;
    let response = codex::fork_task(&connection, &project_id, &task_id, last_turn_id.as_deref())
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    write_task_settings(
        &app_data_dir(&app)?,
        &project_id,
        &response.task.id,
        &settings,
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_task(
    project_id: String,
    task_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::rename_task(&connection, project_id, task_id, title)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pin_task(
    project_id: String,
    task_id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::pin_task(&connection, project_id, task_id, pinned)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn archive_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::archive_task(&connection, project_id, task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn unarchive_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskMutationResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::unarchive_task(&connection, project_id, task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_task(
    app: AppHandle,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let connection = state.codex_connection().await?;
    let response = codex::delete_task(&connection, project_id.clone(), task_id.clone())
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    delete_task_settings(&app_data_dir(&app)?, &project_id, &task_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(response)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn unsubscribe_task(
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<AgentTaskStatusResponse, AppError> {
    let connection = state.codex_connection().await?;
    codex::unsubscribe_task(&connection, &project_id, &task_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}

async fn effective_task_settings(
    app: &AppHandle,
    connection: &codex::AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<AgentTaskSettings, AppError> {
    if let Some(settings) = read_task_settings(&app_data_dir(app)?, project_id, task_id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?
    {
        return Ok(settings);
    }
    let response = codex::get_project_defaults(connection, project_id)
        .await
        .map_err(|_| AppError::CodexRequestFailed)?;
    let settings = serde_json::from_value(
        response
            .get("settings")
            .cloned()
            .ok_or(AppError::CodexRequestFailed)?,
    )
    .map_err(|_| AppError::CodexRequestFailed)?;
    if AgentTaskSettings::is_valid(&settings) {
        Ok(settings)
    } else {
        Err(AppError::CodexRequestFailed)
    }
}
