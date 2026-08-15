use std::sync::Arc;

use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use tauri::{
    State,
    ipc::{Channel, InvokeResponseBody},
};

use crate::{command_error::CommandError, commands::tasks::project};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSubscribeResponse {
    subscription_id: String,
}

fn send_frame(channel: &Channel<InvokeResponseBody>, frame: &[u8]) -> bool {
    // Tauri JSON Channel 需要 owned String；Runtime 已完成协议序列化。
    match String::from_utf8(frame.to_vec()) {
        Ok(frame) => channel.send(InvokeResponseBody::Json(frame)).is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn event_subscribe(
    request_id: String,
    project_id: String,
    after_sequence: u64,
    session_id: String,
    channel: Channel<InvokeResponseBody>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<EventSubscribeResponse, CommandError> {
    let project_id = project(&project_id)?;
    let runtime = runtime.inner().clone();
    let subscription_id = runtime.start_project_event_subscription(
        &tokio::runtime::Handle::current(),
        request_id,
        project_id,
        session_id,
        after_sequence,
        move |frame| std::future::ready(send_frame(&channel, &frame)),
    )?;

    Ok(EventSubscribeResponse { subscription_id })
}

#[tauri::command]
pub async fn event_unsubscribe(
    subscription_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<bool, CommandError> {
    Ok(runtime.cancel_event_subscription(&subscription_id))
}
