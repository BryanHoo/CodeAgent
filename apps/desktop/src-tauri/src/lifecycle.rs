use std::sync::Arc;

use code_agent_runtime::{CodeAgentRuntime, ShutdownGate};

use crate::platform_adapters::CodexSupervisor;

pub struct DesktopLifecycle {
    gate: ShutdownGate,
    runtime: Arc<CodeAgentRuntime>,
    supervisor: Arc<CodexSupervisor>,
}

impl DesktopLifecycle {
    pub fn new(runtime: Arc<CodeAgentRuntime>, supervisor: Arc<CodexSupervisor>) -> Self {
        Self {
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

        // Runtime 先取消交付订阅并关闭操作树，再释放 Codex 子进程。
        if let Err(error) = self.runtime.shutdown().await {
            eprintln!("CodeAgent Desktop failed to shut down cleanly: {error}");
        }
        if let Err(error) = self.supervisor.close().await {
            eprintln!("CodeAgent Desktop failed to stop Codex cleanly: {error}");
        }
        self.gate.finish();
    }
}
