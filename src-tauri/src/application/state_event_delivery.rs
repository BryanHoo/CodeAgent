use std::sync::Arc;

use tokio::sync::{Mutex, OwnedMutexGuard, mpsc::Sender};

use super::RuntimeSession;
use crate::domain::runtime::AppEvent;

pub(super) struct EventDelivery {
    task_windows: Arc<super::super::task_window_runtime::TaskWindowRuntime>,
    _order: OwnedMutexGuard<()>,
    sender: Option<Sender<AppEvent>>,
}

impl EventDelivery {
    pub(super) async fn send(self, event: AppEvent) {
        self.task_windows.observe(&event);
        if let Some(sender) = self.sender {
            // 原生状态已更新；等待容量时不占用状态锁，窗口销毁后继续原生流程。
            let _ = sender.send(event).await;
        }
    }
}

pub(super) async fn prepare_event_delivery(runtime: &Arc<Mutex<RuntimeSession>>) -> EventDelivery {
    let event_order = Arc::clone(&runtime.lock().await.event_order);
    let order = event_order.lock_owned().await;
    let session = runtime.lock().await;
    let sender = session.event_sender.clone();
    // 序号分配和发送共享顺序锁，防止多个发布者在背压期间交错投递。
    EventDelivery {
        task_windows: Arc::clone(&session.task_windows),
        _order: order,
        sender,
    }
}
