use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::time::timeout;

use crate::{
    domain::{
        agent_configuration::AgentRuntimeSettings,
        conversation::{AgentPromptInput, AgentTaskSettings, AgentTurnOptions},
        scheduled_task::ScheduledTask,
    },
    infrastructure::{
        codex, local_settings::read_agent_runtime_settings, task_settings::write_task_settings,
    },
};

use super::{error::AppError, sidebar_prompt_title::prompt_task_title, state::AppState};

pub(crate) async fn start_turn_for_task(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
    mut input: AgentPromptInput,
    options: AgentTurnOptions,
    resume_task: bool,
    state: &AppState,
) -> Result<Value, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    super::attachment_commands::resolve_prompt_attachments(&app_data, project_id, &mut input)
        .await?;
    let connection = state.codex_connection().await?;
    // 在后端读取最新偏好，普通任务和计划任务共用，不增加 WebView 的逐轮传输字段。
    let settings = read_agent_runtime_settings(&app_data)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    // App Server 可能先推送 turn/started，再返回响应，必须提前建立事件归属。
    state.remember_tasks(project_id, [task_id]).await;
    if let Some(task_title) = prompt_task_title(&input) {
        state
            .promote_task_title(project_id, task_id, task_title)
            .await;
    }
    write_task_settings(
        &app_data,
        project_id,
        task_id,
        &AgentTaskSettings::from(&options),
    )
    .await
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    if options.goal_mode {
        if resume_task {
            codex::resume_task(&connection, project_id, task_id, &settings)
                .await
                .map_err(AppError::from)?;
        }
        return start_goal_turn(
            &connection,
            project_id,
            task_id,
            input,
            options,
            &settings,
            state,
        )
        .await;
    }
    let mut response = codex::start_turn(
        &connection,
        project_id.to_owned(),
        task_id.to_owned(),
        input,
        options,
        resume_task,
        &settings,
    )
    .await
    .map_err(AppError::from)?;
    response.checkpoint.sequence = state.project_sequence(project_id).await;
    serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
}

async fn start_goal_turn(
    connection: &codex::AppServerConnection,
    project_id: &str,
    task_id: &str,
    input: AgentPromptInput,
    options: AgentTurnOptions,
    settings: &AgentRuntimeSettings,
    state: &AppState,
) -> Result<Value, AppError> {
    if !input.attachments.is_empty() || !input.skills.is_empty() {
        return Err(AppError::CodexRequestFailed);
    }
    let (waiter_id, turn_started) = state.register_turn_started(task_id).await;
    let result = async {
        codex::update_thread_settings(connection, task_id, &options, settings)
            .await
            .map_err(AppError::from)?;
        codex::set_goal_objective(connection, task_id, &input.text)
            .await
            .map_err(AppError::from)?;
        timeout(Duration::from_secs(30), turn_started)
            .await
            .map_err(|_| AppError::CodexRequestFailed)?
            .map_err(|_| AppError::CodexRequestFailed)
    }
    .await;
    let turn = match result {
        Ok(turn) => turn,
        Err(error) => {
            state.cancel_turn_started(task_id, waiter_id).await;
            return Err(error);
        }
    };
    Ok(json!({
        "checkpoint": {
            "sequence": state.project_sequence(project_id).await,
            "sessionId": codex::RUNTIME_SESSION_ID,
        },
        "taskId": task_id,
        "turn": turn,
    }))
}

pub(crate) async fn start_scheduled_task_turn(
    app: &AppHandle,
    scheduled: &ScheduledTask,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    state
        .start_codex(app, &app_data)
        .await
        .map_err(|error| error.to_string())?;
    let connection = state
        .codex_connection()
        .await
        .map_err(|error| error.to_string())?;
    let response =
        super::task_workspace::start_task(app, &connection, scheduled.project_id.clone())
            .await
            .map_err(|error| error.to_string())?;
    let task_id = response.task.id;
    state
        .remember_task_metadata(
            &scheduled.project_id,
            [(task_id.as_str(), response.task.title.as_str())],
        )
        .await;
    start_turn_for_task(
        app,
        &scheduled.project_id,
        &task_id,
        scheduled.prompt.clone(),
        scheduled.turn_options.clone(),
        false,
        &state,
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(task_id)
}
