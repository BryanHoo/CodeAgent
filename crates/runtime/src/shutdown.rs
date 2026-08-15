use std::sync::atomic::{AtomicU8, Ordering};

use tokio::sync::Notify;

const OPEN: u8 = 0;
const CLOSING: u8 = 1;
const CLOSED: u8 = 2;

/// 保证并发关闭只有一个执行者，其他调用等待同一完成信号。
#[derive(Default)]
pub struct ShutdownGate {
    state: AtomicU8,
    closed: Notify,
}

impl ShutdownGate {
    /// 尝试取得关闭流程所有权。
    pub fn try_begin(&self) -> bool {
        self.state
            .compare_exchange(OPEN, CLOSING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// 等待当前关闭流程完成。
    pub async fn wait_closed(&self) {
        loop {
            // 先注册等待者再读状态，避免 finish 发生在两步之间而丢失唤醒。
            let notified = self.closed.notified();
            if self.state.load(Ordering::Acquire) == CLOSED {
                return;
            }
            notified.await;
        }
    }

    /// 标记关闭完成并唤醒全部等待者。
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
    async fn shutdown_gate_should_allow_one_owner_and_release_all_waiters() {
        let gate = Arc::new(ShutdownGate::default());
        let owners = Arc::new(AtomicUsize::new(0));
        let completed = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();

        for _ in 0..16 {
            let gate = Arc::clone(&gate);
            let owners = Arc::clone(&owners);
            let completed = Arc::clone(&completed);
            tasks.push(tokio::spawn(async move {
                if gate.try_begin() {
                    owners.fetch_add(1, Ordering::Relaxed);
                    tokio::task::yield_now().await;
                    gate.finish();
                } else {
                    gate.wait_closed().await;
                }
                completed.fetch_add(1, Ordering::Relaxed);
            }));
        }

        for task in tasks {
            task.await.expect("shutdown waiter");
        }
        assert_eq!(owners.load(Ordering::Relaxed), 1);
        assert_eq!(completed.load(Ordering::Relaxed), 16);
    }
}
