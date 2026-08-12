use std::sync::Arc;

use code_agent_runtime::CodeAgentRuntime;
use serde_json::{Value, json};
use tauri::State;

use crate::{command_error::CommandError, commands::tasks::project};

#[tauri::command]
pub async fn turn_start(
    request_id: String,
    project_id: String,
    task_id: String,
    input: Value,
    turn_options: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    let turn = runtime
        .start_agent_turn(
            &request_id,
            &project(&project_id)?,
            &task_id,
            json!({ "input": input, "options": turn_options }),
        )
        .await?;
    Ok(json!({ "taskId": task_id, "turn": turn }))
}

#[tauri::command]
pub async fn turn_steer(
    request_id: String,
    project_id: String,
    task_id: String,
    turn_id: String,
    input: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .steer_agent_turn(
            &request_id,
            &project(&project_id)?,
            &task_id,
            &turn_id,
            json!({ "input": input, "taskId": task_id }),
        )
        .await?;
    Ok(json!({ "status": "accepted", "taskId": task_id, "turnId": turn_id }))
}

#[tauri::command]
pub async fn turn_interrupt(
    request_id: String,
    project_id: String,
    task_id: String,
    turn_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    runtime
        .interrupt_agent_turn(&request_id, &project(&project_id)?, &task_id, &turn_id)
        .await?;
    Ok(json!({ "status": "interrupting", "taskId": task_id, "turnId": turn_id }))
}

#[tauri::command]
pub async fn pending_request_resolve(
    request_id: String,
    project_id: String,
    input: Value,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<Value, CommandError> {
    let resolved = runtime
        .resolve_agent_pending_request(&request_id, &project(&project_id)?, input)
        .await?;
    Ok(json!({ "request": resolved }))
}
