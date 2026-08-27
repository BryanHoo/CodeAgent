use std::sync::Arc;

use tokio::sync::{Mutex, mpsc};

use super::{RuntimeSession, spawn_event_forwarder};
use crate::domain::runtime::{AppEvent, ProviderKind, RuntimeStatus};

#[test]
fn runtime_status_should_advance_monotonic_sequence() {
    let mut runtime = RuntimeSession::default();

    let starting = runtime.transition(RuntimeStatus::Starting, Some(ProviderKind::Codex));
    let ready = runtime.transition(RuntimeStatus::Ready, Some(ProviderKind::Codex));
    let AppEvent::RuntimeStatus {
        seq: starting_seq, ..
    } = starting
    else {
        panic!("starting event should contain runtime status");
    };
    let AppEvent::RuntimeStatus { seq: ready_seq, .. } = ready else {
        panic!("ready event should contain runtime status");
    };

    assert_eq!(starting_seq, 1);
    assert_eq!(ready_seq, 2);
    assert_eq!(runtime.snapshot.status, RuntimeStatus::Ready);
    assert_eq!(runtime.snapshot.provider, Some(ProviderKind::Codex));
    assert_eq!(runtime.snapshot.last_seq, 2);
}

#[tokio::test]
async fn closed_app_server_stream_should_mark_runtime_failed() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.snapshot.status = RuntimeStatus::Ready;
        session.snapshot.provider = Some(ProviderKind::Codex);
    }
    let (sender, receiver) = mpsc::channel(1);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver);
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");

    let session = runtime.lock().await;
    assert_eq!(session.snapshot.status, RuntimeStatus::Failed);
    assert!(session.codex_process.is_none());
}
