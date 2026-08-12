use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};

use code_agent_runtime::CodeAgentRuntime;
use tokio::sync::Notify;

use crate::{commands::events::EventSubscriptions, platform_adapters::CodexSupervisor};

const OPEN: u8 = 0;
const CLOSING: u8 = 1;
const CLOSED: u8 = 2;

#[derive(Default)]
struct ShutdownGate {
    state: AtomicU8,
    closed: Notify,
}

impl ShutdownGate {
    fn try_begin(&self) -> bool {
        self.state
            .compare_exchange(OPEN, CLOSING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    async fn wait_closed(&self) {
        loop {
            // 先注册等待者再读状态，避免 finish 发生在两步之间而丢失唤醒。
            let notified = self.closed.notified();
            if self.state.load(Ordering::Acquire) == CLOSED {
                return;
            }
            notified.await;
        }
    }

    fn finish(&self) {
        self.state.store(CLOSED, Ordering::Release);
        self.closed.notify_waiters();
    }
}

pub struct DesktopLifecycle {
    gate: ShutdownGate,
    runtime: Arc<CodeAgentRuntime>,
    subscriptions: Arc<EventSubscriptions>,
    supervisor: Arc<CodexSupervisor>,
}

impl DesktopLifecycle {
    pub fn new(
        subscriptions: Arc<EventSubscriptions>,
        runtime: Arc<CodeAgentRuntime>,
        supervisor: Arc<CodexSupervisor>,
    ) -> Self {
        Self {
            gate: ShutdownGate::default(),
            runtime,
            subscriptions,
            supervisor,
        }
    }

    pub async fn shutdown(&self) {
        if !self.gate.try_begin() {
            self.gate.wait_closed().await;
            return;
        }

        // 顺序固定，确保 Channel 停止后才释放 Runtime 和 Codex 子进程。
        self.subscriptions.close().await;
        if let Err(error) = self.runtime.shutdown().await {
            eprintln!("CodeAgent Desktop failed to shut down cleanly: {error}");
        }
        if let Err(error) = self.supervisor.close().await {
            eprintln!("CodeAgent Desktop failed to stop Codex cleanly: {error}");
        }
        self.gate.finish();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use super::ShutdownGate;

    #[test]
    fn shutdown_gate_allows_one_concurrent_owner() {
        tauri::async_runtime::block_on(async {
            let gate = Arc::new(ShutdownGate::default());
            let owners = Arc::new(AtomicUsize::new(0));
            let mut tasks = Vec::new();
            for _ in 0..8 {
                let gate = gate.clone();
                let owners = owners.clone();
                tasks.push(tauri::async_runtime::spawn(async move {
                    if gate.try_begin() {
                        owners.fetch_add(1, Ordering::Relaxed);
                        gate.finish();
                    } else {
                        gate.wait_closed().await;
                    }
                }));
            }
            for task in tasks {
                task.await.expect("shutdown task should finish");
            }
            assert_eq!(owners.load(Ordering::Relaxed), 1);
        });
    }
}
