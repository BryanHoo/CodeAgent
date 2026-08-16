use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex, MutexGuard},
};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use serde_json::json;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{AgentEventStream, EventCheckpoint, EventReplay, SubscriberSignal};

struct SubscriptionRegistryState {
    accepting: bool,
    active: HashMap<String, CancellationToken>,
}

/// Runtime 内有界的交付订阅注册表。
pub(crate) struct SubscriptionRegistry {
    capacity: usize,
    state: Mutex<SubscriptionRegistryState>,
}

impl SubscriptionRegistry {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            state: Mutex::new(SubscriptionRegistryState {
                accepting: true,
                active: HashMap::new(),
            }),
        }
    }

    pub(crate) fn register(self: &Arc<Self>) -> Result<SubscriptionRegistration, CodeAgentError> {
        let mut state = self.lock_state();
        if !state.accepting {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::ShuttingDown,
                "runtime is shutting down",
                None,
            ));
        }
        if state.active.len() >= self.capacity {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::CapacityExceeded,
                "event subscription capacity exceeded",
                None,
            ));
        }

        let id = loop {
            let candidate = Uuid::new_v4().to_string();
            if !state.active.contains_key(&candidate) {
                break candidate;
            }
        };
        let cancellation = CancellationToken::new();
        state.active.insert(id.clone(), cancellation.clone());
        Ok(SubscriptionRegistration {
            cancellation,
            id,
            registry: Arc::clone(self),
        })
    }

    pub(crate) fn cancel(&self, id: &str) -> bool {
        self.lock_state().active.remove(id).is_some_and(|token| {
            token.cancel();
            true
        })
    }

    pub(crate) fn close(&self) {
        let mut state = self.lock_state();
        state.accepting = false;
        for (_, token) in state.active.drain() {
            token.cancel();
        }
    }

    fn remove(&self, id: &str) {
        self.lock_state().active.remove(id);
    }

    fn lock_state(&self) -> MutexGuard<'_, SubscriptionRegistryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.lock_state().active.len()
    }
}

pub(crate) struct SubscriptionRegistration {
    cancellation: CancellationToken,
    id: String,
    registry: Arc<SubscriptionRegistry>,
}

impl SubscriptionRegistration {
    pub(crate) fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }
}

impl Drop for SubscriptionRegistration {
    fn drop(&mut self) {
        self.registry.remove(&self.id);
    }
}

/// 驱动一次完整订阅；Delivery 回调只负责发送 Runtime 生成的最终 frame。
pub(crate) async fn drive_event_subscription<F, Fut>(
    stream: Arc<AgentEventStream>,
    session_id: &str,
    after_sequence: u64,
    cancellation: CancellationToken,
    mut send: F,
) -> Result<(), CodeAgentError>
where
    F: FnMut(Arc<[u8]>) -> Fut,
    Fut: Future<Output = bool>,
{
    // live-first 保证 checkpoint 与 replay 初始化窗口内的新事件不会丢失。
    let mut subscription = stream.subscribe().await?;
    let checkpoint = stream.checkpoint().await;
    let replay_session = if session_id.is_empty() {
        checkpoint.session_id.as_ref()
    } else {
        session_id
    };
    let replay = stream.replay_after(replay_session, after_sequence).await;

    match replay {
        EventReplay::Events(events) => {
            if !send_frame(
                &mut send,
                &cancellation,
                control_frame(&checkpoint, "connection.ready", None)?,
            )
            .await
            {
                return Ok(());
            }
            for event in events {
                if event.sequence() <= checkpoint.sequence
                    && !send_frame(&mut send, &cancellation, event.shared_frame()).await
                {
                    return Ok(());
                }
            }
        }
        EventReplay::Resync {
            latest_sequence,
            reason,
        } => {
            let checkpoint = EventCheckpoint {
                sequence: latest_sequence,
                session_id: checkpoint.session_id,
            };
            let _ = send_frame(
                &mut send,
                &cancellation,
                control_frame(&checkpoint, "resync.required", Some(reason))?,
            )
            .await;
            return Ok(());
        }
    }

    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Ok(()),
            signal = subscription.signal.changed() => {
                if signal.is_err()
                    || *subscription.signal.borrow() == SubscriberSignal::ResyncRequired
                {
                    let latest = stream.checkpoint().await;
                    let _ = send_frame(
                        &mut send,
                        &cancellation,
                        control_frame(&latest, "resync.required", Some("sequence_gap"))?,
                    )
                    .await;
                    return Ok(());
                }
            }
            event = subscription.events.recv() => {
                let Some(event) = event else { return Ok(()) };
                // live 订阅早于 replay 建立，只交付 checkpoint 之后的新事件。
                if event.sequence() > checkpoint.sequence
                    && !send_frame(&mut send, &cancellation, event.shared_frame()).await
                {
                    return Ok(());
                }
            }
        }
    }
}

async fn send_frame<F, Fut>(
    send: &mut F,
    cancellation: &CancellationToken,
    frame: Arc<[u8]>,
) -> bool
where
    F: FnMut(Arc<[u8]>) -> Fut,
    Fut: Future<Output = bool>,
{
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => false,
        sent = send(frame) => sent,
    }
}

fn control_frame(
    checkpoint: &EventCheckpoint,
    frame_type: &'static str,
    reason: Option<&'static str>,
) -> Result<Arc<[u8]>, CodeAgentError> {
    let value = if let Some(reason) = reason {
        json!({
            "latestSequence": checkpoint.sequence,
            "reason": reason,
            "sessionId": checkpoint.session_id.as_ref(),
            "type": frame_type,
            "version": 2
        })
    } else {
        json!({
            "latestSequence": checkpoint.sequence,
            "sessionId": checkpoint.session_id.as_ref(),
            "type": frame_type,
            "version": 2
        })
    };
    serde_json::to_vec(&value)
        .map(Arc::from)
        .map_err(|error| CodeAgentError::internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Mutex},
        time::Duration,
    };

    use code_agent_protocol::parse_provider_event;
    use serde_json::{Value, json};
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    use crate::{AgentEventStream, EventStreamOptions};

    use super::{SubscriptionRegistry, drive_event_subscription};

    fn stream(subscriber_capacity: usize) -> Arc<AgentEventStream> {
        Arc::new(
            AgentEventStream::new(EventStreamOptions {
                capacity: 8,
                max_event_bytes: 8_192,
                max_retained_bytes: 32_768,
                now: Arc::new(|| chrono::DateTime::UNIX_EPOCH),
                provider: Arc::from("codex"),
                session_id: Arc::from("session-1"),
                subscriber_capacity,
            })
            .expect("stream"),
        )
    }

    fn event(delta: &str) -> code_agent_protocol::ProviderEvent {
        parse_provider_event(json!({
            "itemId": "item-1",
            "payload": { "delta": delta },
            "taskId": "task-1",
            "turnId": "turn-1",
            "type": "message.delta"
        }))
        .expect("event")
    }

    fn decode(frame: &[u8]) -> Value {
        serde_json::from_slice(frame).expect("valid frame")
    }

    #[tokio::test]
    async fn event_subscription_should_replay_empty_session_then_continue_after_checkpoint() {
        let stream = stream(8);
        stream.publish(event("replay")).await;
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let (frames, mut received) = tokio::sync::mpsc::unbounded_channel();
        let task_stream = Arc::clone(&stream);
        let task = tokio::spawn(async move {
            drive_event_subscription(task_stream, "", 0, task_cancellation, move |frame| {
                std::future::ready(frames.send(frame).is_ok())
            })
            .await
        });

        let ready = received.recv().await.expect("ready");
        let replay = received.recv().await.expect("replay");
        assert_eq!(decode(&ready)["type"], "connection.ready");
        assert_eq!(decode(&replay)["sequence"], 1);

        stream.publish(event("live")).await;
        let live = received.recv().await.expect("live");
        assert_eq!(decode(&live)["sequence"], 2);

        cancellation.cancel();
        task.await.expect("task").expect("subscription");
    }

    #[tokio::test]
    async fn event_subscription_should_send_one_resync_frame_for_session_change() {
        let frames = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&frames);

        drive_event_subscription(
            stream(8),
            "old-session",
            0,
            CancellationToken::new(),
            move |frame| {
                sink.lock().expect("frames").push(frame);
                std::future::ready(true)
            },
        )
        .await
        .expect("subscription");

        let frames = frames.lock().expect("frames");
        assert_eq!(frames.len(), 1);
        assert_eq!(decode(&frames[0])["type"], "resync.required");
        assert_eq!(decode(&frames[0])["reason"], "session_changed");
    }

    #[tokio::test]
    async fn event_subscription_should_prioritize_resync_when_live_queue_overflows() {
        let stream = stream(1);
        let entered_send = Arc::new(Notify::new());
        let release_send = Arc::new(Notify::new());
        let sink_entered = Arc::clone(&entered_send);
        let sink_release = Arc::clone(&release_send);
        let frames = Arc::new(Mutex::new(Vec::new()));
        let sink_frames = Arc::clone(&frames);
        let task_stream = Arc::clone(&stream);
        let task = tokio::spawn(async move {
            drive_event_subscription(
                task_stream,
                "session-1",
                0,
                CancellationToken::new(),
                move |frame| {
                    let sink_entered = Arc::clone(&sink_entered);
                    let sink_release = Arc::clone(&sink_release);
                    let sink_frames = Arc::clone(&sink_frames);
                    async move {
                        let is_ready = decode(&frame)["type"] == "connection.ready";
                        sink_frames.lock().expect("frames").push(frame);
                        if is_ready {
                            sink_entered.notify_one();
                            sink_release.notified().await;
                        }
                        true
                    }
                },
            )
            .await
        });

        entered_send.notified().await;
        stream.publish(event("queued")).await;
        stream.publish(event("overflow")).await;
        stream.flush().await;
        release_send.notify_one();
        task.await.expect("task").expect("subscription");

        let frames = frames.lock().expect("frames");
        assert_eq!(frames.len(), 2);
        assert_eq!(decode(&frames[1])["type"], "resync.required");
        assert_eq!(decode(&frames[1])["latestSequence"], 2);
    }

    #[tokio::test]
    async fn event_subscription_should_stop_and_cleanup_after_send_failure_or_cancel() {
        let registry = Arc::new(SubscriptionRegistry::new(2));
        let registration = registry.register().expect("registration");
        let cancellation = registration.cancellation().clone();
        let id = registration.id().to_owned();

        drive_event_subscription(stream(8), "", 0, cancellation, |_| {
            std::future::ready(false)
        })
        .await
        .expect("subscription");
        drop(registration);
        assert_eq!(registry.active_count(), 0);

        let registration = registry.register().expect("registration");
        let cancellation = registration.cancellation().clone();
        assert!(registry.cancel(registration.id()));
        drive_event_subscription(stream(8), "", 0, cancellation, |_| std::future::ready(true))
            .await
            .expect("subscription");
        drop(registration);
        assert_eq!(registry.active_count(), 0);
        assert!(!registry.cancel(&id));
    }

    #[tokio::test]
    async fn event_subscription_should_not_hang_when_cancelled_during_send() {
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            drive_event_subscription(stream(8), "", 0, task_cancellation, |_| async {
                std::future::pending::<bool>().await
            })
            .await
        });

        cancellation.cancel();
        tokio::time::timeout(Duration::from_millis(100), task)
            .await
            .expect("cancel should stop pending send")
            .expect("task")
            .expect("subscription");
    }
}
