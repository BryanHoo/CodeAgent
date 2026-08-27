use std::sync::Mutex;

use tauri::ipc::Channel;

use super::error::AppError;
use crate::domain::runtime::{AppEvent, RuntimeSnapshot};

#[derive(Default)]
pub struct AppState {
    runtime: Mutex<RuntimeSession>,
}

#[derive(Default)]
struct RuntimeSession {
    event_channel: Option<Channel<AppEvent>>,
    snapshot: RuntimeSnapshot,
}

impl AppState {
    pub fn connect(&self, event_channel: Channel<AppEvent>) -> Result<RuntimeSnapshot, AppError> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| AppError::RuntimeStateUnavailable)?;

        // 保留唯一 Channel 所有权，后续运行时任务通过这里向 WebView 发布归一化事件。
        runtime.event_channel = Some(event_channel);
        Ok(runtime.snapshot)
    }
}
