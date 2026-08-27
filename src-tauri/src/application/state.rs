use std::path::Path;

use tauri::ipc::Channel;
use tokio::sync::Mutex;

use super::error::AppError;
use crate::{
    domain::runtime::{AppEvent, ProviderKind, RuntimeSnapshot, RuntimeStatus},
    infrastructure::codex::CodexProcess,
};

#[derive(Default)]
pub struct AppState {
    runtime: Mutex<RuntimeSession>,
}

#[derive(Default)]
struct RuntimeSession {
    event_channel: Option<Channel<AppEvent>>,
    snapshot: RuntimeSnapshot,
    codex_process: Option<CodexProcess>,
}

impl AppState {
    pub async fn connect(&self, event_channel: Channel<AppEvent>) -> RuntimeSnapshot {
        let mut runtime = self.runtime.lock().await;

        // 保留唯一 Channel 所有权，后续运行时任务通过这里向 WebView 发布归一化事件。
        runtime.event_channel = Some(event_channel);
        runtime.snapshot
    }

    pub async fn start_codex(&self, codex_home: &Path) -> Result<RuntimeSnapshot, AppError> {
        {
            let mut runtime = self.runtime.lock().await;
            if matches!(
                runtime.snapshot.status,
                RuntimeStatus::Starting | RuntimeStatus::Ready
            ) {
                return Ok(runtime.snapshot);
            }
            let event = runtime.transition(RuntimeStatus::Starting, Some(ProviderKind::Codex));
            runtime.publish(event)?;
        }

        let process = CodexProcess::start(codex_home).await;
        let mut runtime = self.runtime.lock().await;

        match process {
            Ok(process) => {
                runtime.codex_process = Some(process);
                let event = runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
                runtime.publish(event)?;
                Ok(runtime.snapshot)
            }
            Err(error) => {
                eprintln!("codex runtime startup failed: {error}");
                let event = runtime.transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
                runtime.publish(event)?;
                Err(AppError::CodexRuntimeStartFailed)
            }
        }
    }
}

impl RuntimeSession {
    fn transition(&mut self, status: RuntimeStatus, provider: Option<ProviderKind>) -> AppEvent {
        self.snapshot.last_seq += 1;
        self.snapshot.status = status;
        self.snapshot.provider = provider;
        AppEvent::RuntimeStatus {
            seq: self.snapshot.last_seq,
            status,
            provider,
        }
    }

    fn publish(&self, event: AppEvent) -> Result<(), AppError> {
        self.event_channel
            .as_ref()
            .ok_or(AppError::RuntimeChannelUnavailable)?
            .send(event)
            .map_err(|_| AppError::RuntimeEventDeliveryFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeSession;
    use crate::domain::runtime::{AppEvent, ProviderKind, RuntimeStatus};

    #[test]
    fn runtime_status_should_advance_monotonic_sequence() {
        let mut runtime = RuntimeSession::default();

        let starting = runtime.transition(RuntimeStatus::Starting, Some(ProviderKind::Codex));
        let ready = runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
        let AppEvent::RuntimeStatus {
            seq: starting_seq, ..
        } = starting;
        let AppEvent::RuntimeStatus { seq: ready_seq, .. } = ready;

        assert_eq!(starting_seq, 1);
        assert_eq!(ready_seq, 2);
        assert_eq!(runtime.snapshot.status, RuntimeStatus::Ready);
        assert_eq!(runtime.snapshot.provider, Some(ProviderKind::Codex));
        assert_eq!(runtime.snapshot.last_seq, 2);
    }
}
