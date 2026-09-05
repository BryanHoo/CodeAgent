use super::{AppState, RuntimeSession, spawn_event_forwarder};
use crate::domain::runtime::{AppEvent, ProviderKind, RuntimeStatus};
use crate::infrastructure::codex::{ServerMessage, map_server_request_now};
use serde_json::{json, value::to_raw_value};
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio::time::{Duration, timeout};

#[tokio::test]
async fn concurrent_start_should_wait_for_the_same_ready_runtime() {
    let state = Arc::new(AppState::default());
    let first_state = Arc::clone(&state);
    let (entered_tx, entered_rx) = oneshot::channel();
    let (ready_tx, ready_rx) = oneshot::channel();
    let first = tokio::spawn(async move {
        first_state
            .start_runtime_once(|| async {
                entered_tx.send(()).unwrap();
                ready_rx.await.unwrap();
                let mut runtime = first_state.runtime.lock().await;
                runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
                Ok(runtime.snapshot)
            })
            .await
    });
    entered_rx.await.unwrap();
    let second_state = Arc::clone(&state);
    let mut second = tokio::spawn(async move {
        second_state
            .start_runtime_once(|| async { panic!("runtime must only start once") })
            .await
    });
    assert!(
        timeout(Duration::from_millis(30), &mut second)
            .await
            .is_err(),
        "concurrent caller returned before readiness"
    );
    ready_tx.send(()).unwrap();
    assert_eq!(first.await.unwrap().unwrap().status, RuntimeStatus::Ready);
    assert_eq!(second.await.unwrap().unwrap().status, RuntimeStatus::Ready);
}

#[tokio::test]
async fn saturated_channel_should_preserve_the_final_failed_status() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    let (sender, mut receiver) = mpsc::channel(1);
    sender
        .send(AppEvent::RuntimeStatus {
            seq: 0,
            provider: None,
            status: RuntimeStatus::Starting,
        })
        .await
        .unwrap();
    runtime.lock().await.event_sender = Some(sender);
    let (source, messages) = mpsc::channel(1);
    let forwarder = spawn_event_forwarder(Arc::clone(&runtime), messages, None);
    drop(source);
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        timeout(Duration::from_millis(50), runtime.lock())
            .await
            .is_ok(),
        "backpressure must not hold runtime lock"
    );
    receiver.recv().await.unwrap();
    let event = timeout(Duration::from_millis(200), receiver.recv())
        .await
        .expect("final status was lost")
        .unwrap();
    assert!(matches!(
        event,
        AppEvent::RuntimeStatus {
            status: RuntimeStatus::Failed,
            ..
        }
    ));
    forwarder.await.unwrap();
}

#[tokio::test]
async fn waiting_publishers_should_not_hold_runtime_lock_or_reorder_events() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    let (sender, mut receiver) = mpsc::channel(2);
    runtime.lock().await.event_sender = Some(sender);
    let first = super::prepare_event_delivery(&runtime).await;
    let next_runtime = Arc::clone(&runtime);
    let second = tokio::spawn(async move { super::prepare_event_delivery(&next_runtime).await });
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        timeout(Duration::from_millis(50), runtime.lock())
            .await
            .is_ok()
    );
    first
        .send(AppEvent::RuntimeStatus {
            seq: 1,
            provider: None,
            status: RuntimeStatus::Starting,
        })
        .await;
    second
        .await
        .unwrap()
        .send(AppEvent::RuntimeStatus {
            seq: 2,
            provider: None,
            status: RuntimeStatus::Ready,
        })
        .await;
    assert!(matches!(
        receiver.recv().await,
        Some(AppEvent::RuntimeStatus { seq: 1, .. })
    ));
    assert!(matches!(
        receiver.recv().await,
        Some(AppEvent::RuntimeStatus { seq: 2, .. })
    ));
}

#[tokio::test]
async fn saturated_channel_should_deliver_resolved_and_expired_approvals() {
    for resolved in [true, false] {
        let state = Arc::new(AppState::default());
        let (sender, mut receiver) = mpsc::channel(1);
        sender
            .send(AppEvent::RuntimeStatus {
                seq: 0,
                provider: None,
                status: RuntimeStatus::Starting,
            })
            .await
            .unwrap();
        state.runtime.lock().await.event_sender = Some(sender);
        let mut pending = map_server_request_now(ServerMessage {
            id: Some(9),
            method: "item/commandExecution/requestApproval".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a", "turnId": "turn-a", "itemId": "item-a", "kind": "command",
                "startedAtMs": 1735689600000_i64, "command": "pnpm check", "cwd": "/work/a",
                "availableDecisions": ["accept", "decline"]
            })).unwrap(),
        }, 0).unwrap().unwrap().pending;
        pending.request["projectId"] = json!("project-a");
        let task_state = Arc::clone(&state);
        let task = tokio::spawn(async move {
            if resolved {
                task_state.publish_resolved_request(&pending).await.unwrap();
            } else {
                task_state
                    .runtime
                    .lock()
                    .await
                    .pending_requests
                    .insert("number:9".to_owned(), pending);
                let (source, messages) = mpsc::channel(1);
                source
                    .send(ServerMessage {
                        id: None,
                        method: "serverRequest/resolved".to_owned(),
                        params: to_raw_value(&json!({"requestId": 9})).unwrap(),
                    })
                    .await
                    .unwrap();
                drop(source);
                spawn_event_forwarder(Arc::clone(&task_state.runtime), messages, None)
                    .await
                    .unwrap();
            }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            timeout(Duration::from_millis(50), state.runtime.lock())
                .await
                .is_ok()
        );
        receiver.recv().await.unwrap();
        let event = timeout(Duration::from_millis(200), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        let AppEvent::AgentEvent { event } = event else {
            panic!("approval event required")
        };
        assert_eq!(
            event.event_type(),
            Some(if resolved {
                "pending_request.resolved"
            } else {
                "pending_request.expired"
            })
        );
        task.await.unwrap();
    }
}
