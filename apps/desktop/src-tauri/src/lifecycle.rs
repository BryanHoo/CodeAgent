use std::sync::Arc;

use code_agent_runtime::{CodeAgentRuntime, ShutdownGate};

use crate::{commands::events::EventDeliveryRegistry, platform_adapters::CodexSupervisor};

pub struct DesktopLifecycle {
    event_deliveries: Arc<EventDeliveryRegistry>,
    gate: ShutdownGate,
    runtime: Arc<CodeAgentRuntime>,
    supervisor: Arc<CodexSupervisor>,
}

impl DesktopLifecycle {
    pub fn new(
        event_deliveries: Arc<EventDeliveryRegistry>,
        runtime: Arc<CodeAgentRuntime>,
        supervisor: Arc<CodexSupervisor>,
    ) -> Self {
        Self {
            event_deliveries,
            gate: ShutdownGate::default(),
            runtime,
            supervisor,
        }
    }

    pub async fn shutdown(&self) {
        if !self.gate.try_begin() {
            self.gate.wait_closed().await;
            return;
        }

        // 先唤醒并清空 mailbox 等待者，再取消 Runtime 交付订阅。
        self.event_deliveries.close_all();
        if let Err(error) = self.runtime.shutdown().await {
            eprintln!("CodeAgent Desktop failed to shut down cleanly: {error}");
        }
        if let Err(error) = self.supervisor.close().await {
            eprintln!("CodeAgent Desktop failed to stop Codex cleanly: {error}");
        }
        self.gate.finish();
    }
}
