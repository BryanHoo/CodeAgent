use std::sync::atomic::{AtomicU8, Ordering};

use tokio::sync::Notify;

pub mod attachments;
pub mod files;
pub mod git;
pub mod projects;
pub mod provider;
pub mod settings;
pub mod tasks;

use std::str::FromStr;

use code_agent_protocol::{ProjectId, TaskId};

use crate::errors::invalid_input;

const OPEN: u8 = 0;
const CLOSING: u8 = 1;
const CLOSED: u8 = 2;

#[derive(Default)]
pub struct ShutdownGate {
    closed: Notify,
    state: AtomicU8,
}

pub fn project_id(value: &str) -> napi::Result<ProjectId> {
    ProjectId::from_str(value).map_err(|_| invalid_input("projectId must not be empty"))
}

pub fn task_id(value: &str) -> napi::Result<TaskId> {
    TaskId::from_str(value).map_err(|_| invalid_input("taskId must not be empty"))
}

impl ShutdownGate {
    pub fn try_begin(&self) -> bool {
        self.state
            .compare_exchange(OPEN, CLOSING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub async fn wait_closed(&self) {
        loop {
            let notified = self.closed.notified();
            if self.state.load(Ordering::Acquire) == CLOSED {
                return;
            }
            notified.await;
        }
    }

    pub fn finish(&self) {
        self.state.store(CLOSED, Ordering::Release);
        self.closed.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use super::ShutdownGate;

    #[tokio::test]
    async fn concurrent_shutdown_has_one_owner() {
        let gate = Arc::new(ShutdownGate::default());
        let owners = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let gate = gate.clone();
            let owners = owners.clone();
            tasks.push(tokio::spawn(async move {
                if gate.try_begin() {
                    owners.fetch_add(1, Ordering::Relaxed);
                    gate.finish();
                } else {
                    gate.wait_closed().await;
                }
            }));
        }
        for task in tasks {
            task.await.expect("shutdown waiter should finish");
        }
        assert_eq!(owners.load(Ordering::Relaxed), 1);
    }
}
