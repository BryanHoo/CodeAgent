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
    // Provider 当前消费 Codex 原生 Turn 参数；在 Delivery 边界集中展开公共 options。
    let native_input = json!({
        "approvalPolicy": turn_options["approvalPolicy"],
        "approvalsReviewer": turn_options["approvalsReviewer"],
        "collaborationMode": {
            "mode": turn_options["collaborationMode"].as_str().unwrap_or("default"),
            "settings": {
                "developer_instructions": null,
                "model": turn_options["model"],
                "reasoning_effort": turn_options["reasoningEffort"]
            }
        },
        "effort": turn_options["reasoningEffort"],
        "input": [{ "text": input["text"].as_str().unwrap_or_default(), "text_elements": [], "type": "text" }],
        "model": turn_options["model"],
        "sandboxPolicy": sandbox_policy(turn_options["sandboxMode"].as_str().unwrap_or("workspace-write"))
    });
    let turn = runtime
        .start_agent_turn(&request_id, &project(&project_id)?, &task_id, native_input)
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
            json!({ "input": [{ "text": input["text"].as_str().unwrap_or_default(), "text_elements": [], "type": "text" }] }),
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

fn sandbox_policy(mode: &str) -> Value {
    match mode {
        "read-only" => json!({ "networkAccess": false, "type": "readOnly" }),
        "danger-full-access" => json!({ "type": "dangerFullAccess" }),
        _ => json!({
            "networkAccess": false,
            "type": "workspaceWrite",
            "writableRoots": [],
        }),
    }
}
