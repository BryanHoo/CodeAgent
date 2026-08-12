use std::{collections::HashMap, sync::Arc};

use code_agent_runtime::{CodeAgentRuntime, EventReplay, SubscriberSignal};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{State, ipc::Channel};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{command_error::CommandError, commands::tasks::project};

#[derive(Default)]
pub struct EventSubscriptions {
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl EventSubscriptions {
    async fn insert(&self, id: String, cancellation: CancellationToken) {
        self.active.lock().await.insert(id, cancellation);
    }

    async fn remove(&self, id: &str) -> bool {
        self.active
            .lock()
            .await
            .remove(id)
            .is_some_and(|cancellation| {
                cancellation.cancel();
                true
            })
    }

    pub async fn close(&self) {
        for (_, cancellation) in self.active.lock().await.drain() {
            cancellation.cancel();
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSubscribeResponse {
    subscription_id: String,
}

fn send_replay(
    channel: &Channel<Value>,
    replay: EventReplay,
    checkpoint: &code_agent_runtime::EventCheckpoint,
) -> bool {
    let send = |message: Value| channel.send(message).is_ok();
    match replay {
        EventReplay::Events(events) => {
            if !send(json!({
                "latestSequence": checkpoint.sequence,
                "sessionId": checkpoint.session_id.as_ref(),
                "type": "connection.ready",
                "version": 2
            })) {
                return false;
            }
            for event in events {
                // replay 获取期间的新事件留给实时队列，维持 checkpoint 分界。
                if event.sequence() <= checkpoint.sequence && !send(event.value().clone()) {
                    return false;
                }
            }
            true
        }
        EventReplay::Resync {
            latest_sequence,
            reason,
        } => {
            let _ = send(json!({
                "latestSequence": latest_sequence,
                "reason": reason,
                "sessionId": checkpoint.session_id.as_ref(),
                "type": "resync.required",
                "version": 2
            }));
            false
        }
    }
}

#[tauri::command]
pub async fn event_subscribe(
    request_id: String,
    project_id: String,
    after_sequence: u64,
    session_id: String,
    channel: Channel<Value>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
    subscriptions: State<'_, Arc<EventSubscriptions>>,
) -> Result<EventSubscribeResponse, CommandError> {
    let project_id = project(&project_id)?;
    // 先建立实时订阅，再读取 replay，避免初始化期间丢失新事件。
    let mut subscription = runtime
        .subscribe_project_events(&format!("{request_id}:live"), &project_id)
        .await?;
    let checkpoint = runtime
        .project_event_checkpoint(&format!("{request_id}:checkpoint"), &project_id)
        .await?;
    let replay = runtime
        .replay_project_events(&request_id, &project_id, &session_id, after_sequence)
        .await?;
    let subscription_id = Uuid::new_v4().to_string();
    let cancellation = CancellationToken::new();
    subscriptions
        .insert(subscription_id.clone(), cancellation.clone())
        .await;

    let registry = subscriptions.inner().clone();
    let runtime = runtime.inner().clone();
    let resync_project_id = project_id.clone();
    let resync_request_id = request_id.clone();
    let cleanup_id = subscription_id.clone();
    tauri::async_runtime::spawn(async move {
        let send = |message: Value| channel.send(message).is_ok();
        if !send_replay(&channel, replay, &checkpoint) {
            registry.remove(&cleanup_id).await;
            return;
        }

        loop {
            tokio::select! {
                _ = cancellation.cancelled() => break,
                signal = subscription.signal.changed() => {
                    if signal.is_err() || *subscription.signal.borrow() == SubscriberSignal::ResyncRequired {
                        let latest = runtime
                            .project_event_checkpoint(
                                &format!("{resync_request_id}:resync-checkpoint"),
                                &resync_project_id,
                            )
                            .await
                            .unwrap_or_else(|_| checkpoint.clone());
                        let _ = send(json!({
                            "latestSequence": latest.sequence,
                            "reason": "sequence_gap",
                            "sessionId": latest.session_id.as_ref(),
                            "type": "resync.required",
                            "version": 2
                        }));
                        break;
                    }
                }
                event = subscription.events.recv() => {
                    let Some(event) = event else { break };
                    // 订阅先于 replay 创建，丢弃已由 replay 交付的同序号事件。
                    if event.sequence() <= checkpoint.sequence {
                        continue;
                    }
                    if !send(event.value().clone()) {
                        break;
                    }
                }
            }
        }
        registry.remove(&cleanup_id).await;
    });

    Ok(EventSubscribeResponse { subscription_id })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use code_agent_runtime::{AgentEventStream, EventStreamOptions};
    use serde_json::{Value, json};
    use tauri::ipc::{Channel, InvokeResponseBody};
    use tokio_util::sync::CancellationToken;

    use super::{EventSubscriptions, send_replay};

    #[tokio::test]
    async fn replay_sends_ready_before_events_and_unsubscribe_cleans_registry() {
        let stream = AgentEventStream::new(EventStreamOptions {
            capacity: 8,
            max_event_bytes: 8_192,
            max_retained_bytes: 32_768,
            now: Arc::new(|| chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())),
            provider: Arc::from("codex"),
            session_id: Arc::from("session-1"),
            subscriber_capacity: 8,
        })
        .expect("stream");
        stream
            .publish(
                code_agent_protocol::parse_provider_event(json!({
                    "itemId": "item-1", "payload": { "delta": "hello" },
                    "taskId": "task-1", "turnId": "turn-1", "type": "message.delta"
                }))
                .expect("event"),
            )
            .await;
        let checkpoint = stream.checkpoint().await;
        let replay = stream.replay_after("session-1", 0).await;
        let messages = Arc::new(Mutex::new(Vec::<Value>::new()));
        let sink = messages.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(value) = body {
                sink.lock()
                    .expect("messages")
                    .push(serde_json::from_str(&value)?);
            }
            Ok(())
        });
        assert!(send_replay(&channel, replay, &checkpoint));
        {
            let messages = messages.lock().expect("messages");
            assert_eq!(messages[0]["type"], "connection.ready");
            assert_eq!(messages[1]["type"], "message.delta");
        }

        let registry = EventSubscriptions::default();
        registry
            .insert("subscription-1".to_owned(), CancellationToken::new())
            .await;
        assert!(registry.remove("subscription-1").await);
        assert!(!registry.remove("subscription-1").await);
    }

    #[tokio::test]
    async fn replay_stops_after_resync_message() {
        let stream = AgentEventStream::new(EventStreamOptions {
            capacity: 1,
            max_event_bytes: 8_192,
            max_retained_bytes: 8_192,
            now: Arc::new(|| chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())),
            provider: Arc::from("codex"),
            session_id: Arc::from("session-2"),
            subscriber_capacity: 1,
        })
        .expect("stream");
        let checkpoint = stream.checkpoint().await;
        let messages = Arc::new(Mutex::new(Vec::<Value>::new()));
        let sink = messages.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(value) = body {
                sink.lock()
                    .expect("messages")
                    .push(serde_json::from_str(&value)?);
            }
            Ok(())
        });
        assert!(!send_replay(
            &channel,
            stream.replay_after("old-session", 0).await,
            &checkpoint,
        ));
        let messages = messages.lock().expect("messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["type"], "resync.required");
        assert_eq!(messages[0]["reason"], "session_changed");
    }
}

#[tauri::command]
pub async fn event_unsubscribe(
    subscription_id: String,
    subscriptions: State<'_, Arc<EventSubscriptions>>,
) -> Result<bool, CommandError> {
    Ok(subscriptions.remove(&subscription_id).await)
}
