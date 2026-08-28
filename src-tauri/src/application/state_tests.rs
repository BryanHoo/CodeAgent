use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicBool, Ordering},
};

use serde_json::{Value, json, value::to_raw_value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::{Mutex, mpsc};

use super::{RuntimeSession, spawn_event_forwarder};
use crate::domain::runtime::{AppEvent, ProviderKind, RuntimeStatus};
use crate::infrastructure::codex::ServerMessage;

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

#[tokio::test]
async fn task_scoped_mcp_status_should_be_cached_and_forwarded() {
    let published = Arc::new(StdMutex::new(Vec::new()));
    let published_for_channel = Arc::clone(&published);
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(value) = body {
            published_for_channel.lock().unwrap().push(value);
        }
        Ok(())
    });
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    {
        let mut session = runtime.lock().await;
        session.set_event_channel(channel);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
    }
    let (sender, receiver) = mpsc::channel(1);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver);
    sender
        .send(ServerMessage {
            id: None,
            method: "mcpServer/startupStatus/updated".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "name": "context7",
                "status": "ready",
                "error": null,
                "failureReason": null
            }))
            .unwrap(),
        })
        .await
        .unwrap();
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");

    let session = runtime.lock().await;
    assert_eq!(
        session.mcp_statuses["thread-a\0context7"]["status"],
        "ready"
    );
    let events = published.lock().unwrap();
    let agent_event = events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(event).ok())
        .find(|event| {
            event.pointer("/data/event/type").and_then(Value::as_str)
                == Some("mcp_server.status_updated")
        })
        .expect("task-scoped MCP status should be published");
    assert_eq!(agent_event["data"]["event"]["taskId"], "thread-a");
}

#[tokio::test]
async fn event_channel_should_run_without_holding_runtime_lock() {
    let runtime = Arc::new(Mutex::new(RuntimeSession::default()));
    let runtime_for_channel = Arc::clone(&runtime);
    let lock_was_available = Arc::new(AtomicBool::new(false));
    let lock_was_available_for_channel = Arc::clone(&lock_was_available);
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(value) = body
            && serde_json::from_str::<Value>(&value)
                .ok()
                .and_then(|event| event.pointer("/data/event/type").cloned())
                == Some(json!("mcp_server.status_updated"))
        {
            lock_was_available_for_channel
                .store(runtime_for_channel.try_lock().is_ok(), Ordering::Relaxed);
        }
        Ok(())
    });
    {
        let mut session = runtime.lock().await;
        session.set_event_channel(channel);
        session
            .task_projects
            .insert("thread-a".to_owned(), "project-a".to_owned());
    }
    let (sender, receiver) = mpsc::channel(1);
    let task = spawn_event_forwarder(Arc::clone(&runtime), receiver);
    sender
        .send(ServerMessage {
            id: None,
            method: "mcpServer/startupStatus/updated".to_owned(),
            params: to_raw_value(&json!({
                "threadId": "thread-a",
                "name": "context7",
                "status": "ready"
            }))
            .unwrap(),
        })
        .await
        .unwrap();
    drop(sender);
    task.await.expect("event forwarder should stop cleanly");

    assert!(
        lock_was_available.load(Ordering::Relaxed),
        "runtime lock should be released before Channel::send"
    );
}
