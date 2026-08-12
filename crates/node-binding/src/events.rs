use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use code_agent_runtime::{EventReplay, SubscriberSignal};
use napi::{
    Status,
    bindgen_prelude::{Buffer, Function},
    threadsafe_function::ThreadsafeFunction,
};
use napi_derive::napi;
use serde_json::json;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{NodeEngine, operations::project_id};

type EventCallback = ThreadsafeFunction<Vec<u8>, (), Buffer, Status, false, true, 1>;
const MAX_BRIDGE_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Default)]
pub struct EventSubscriptions {
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl EventSubscriptions {
    fn insert(&self, id: String, cancellation: CancellationToken) {
        if let Ok(mut active) = self.active.lock() {
            active.insert(id, cancellation);
        }
    }

    fn remove(&self, id: &str) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|mut active| active.remove(id))
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }

    pub fn close(&self) {
        if let Ok(mut active) = self.active.lock() {
            for (_, token) in active.drain() {
                token.cancel();
            }
        }
    }
}

#[napi]
pub struct NodeEventSubscription {
    cancellation: CancellationToken,
    id: String,
    registry: Arc<EventSubscriptions>,
}

#[napi]
impl NodeEventSubscription {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[napi]
    pub fn unsubscribe(&self) -> bool {
        self.cancellation.cancel();
        self.registry.remove(&self.id)
    }
}

fn frame(value: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&value).unwrap_or_else(|_| {
        b"{\"type\":\"resync.required\",\"reason\":\"sequence_gap\",\"version\":2}".to_vec()
    })
}

async fn send(callback: &EventCallback, bytes: Vec<u8>) -> bool {
    bytes.len() <= MAX_BRIDGE_FRAME_BYTES && callback.call_async(bytes).await.is_ok()
}

#[napi]
impl NodeEngine {
    #[napi]
    pub fn event_subscribe(
        &self,
        request_id: String,
        project: String,
        session_id: String,
        after_sequence: i64,
        callback: Function<'_, Buffer, ()>,
    ) -> napi::Result<NodeEventSubscription> {
        let after_sequence = u64::try_from(after_sequence)
            .map_err(|_| crate::errors::invalid_input("afterSequence must be non-negative"))?;
        let project = project_id(&project)?;
        let callback = callback
            .build_threadsafe_function::<Vec<u8>>()
            .weak::<true>()
            .max_queue_size::<1>()
            .build_callback(|context| Ok(Buffer::from(context.value)))?;
        let cancellation = CancellationToken::new();
        let id = Uuid::new_v4().to_string();
        let registry = self.event_subscriptions();
        registry.insert(id.clone(), cancellation.clone());

        let runtime = self.runtime_arc();
        let task_id = id.clone();
        let task_registry = registry.clone();
        let task_cancellation = cancellation.clone();
        self.tokio_handle().spawn(async move {
            let result = async {
                // 先订阅实时队列，再固定 checkpoint 和读取 replay，避免初始化窗口丢事件。
                let mut subscription = runtime
                    .subscribe_project_events(&format!("{request_id}:live"), &project)
                    .await?;
                let checkpoint = runtime
                    .project_event_checkpoint(&format!("{request_id}:checkpoint"), &project)
                    .await?;
                // HTTP WebSocket 只携带 sequence；空 session 使用当前 checkpoint，
                // 客户端仍会依据 connection.ready 校验自身 snapshot session。
                let replay_session = if session_id.is_empty() {
                    checkpoint.session_id.as_ref()
                } else {
                    &session_id
                };
                let replay = runtime
                    .replay_project_events(&request_id, &project, replay_session, after_sequence)
                    .await?;

                match replay {
                    EventReplay::Events(events) => {
                        if !send(
                            &callback,
                            frame(json!({
                                "latestSequence": checkpoint.sequence,
                                "sessionId": checkpoint.session_id.as_ref(),
                                "type": "connection.ready", "version": 2
                            })),
                        )
                        .await
                        {
                            return Ok::<(), code_agent_core::CodeAgentError>(());
                        }
                        for event in events
                            .into_iter()
                            .filter(|event| event.sequence() <= checkpoint.sequence)
                        {
                            if !send(&callback, event.frame().to_vec()).await {
                                return Ok(());
                            }
                        }
                    }
                    EventReplay::Resync {
                        latest_sequence,
                        reason,
                    } => {
                        let _ = send(
                            &callback,
                            frame(json!({
                                "latestSequence": latest_sequence, "reason": reason,
                                "sessionId": checkpoint.session_id.as_ref(),
                                "type": "resync.required", "version": 2
                            })),
                        )
                        .await;
                        return Ok(());
                    }
                }

                loop {
                    tokio::select! {
                        _ = task_cancellation.cancelled() => break,
                        signal = subscription.signal.changed() => {
                            if signal.is_err() || *subscription.signal.borrow() == SubscriberSignal::ResyncRequired {
                                let latest = runtime
                                    .project_event_checkpoint(&format!("{request_id}:resync"), &project)
                                    .await
                                    .unwrap_or(checkpoint.clone());
                                let _ = send(&callback, frame(json!({
                                    "latestSequence": latest.sequence, "reason": "sequence_gap",
                                    "sessionId": latest.session_id.as_ref(),
                                    "type": "resync.required", "version": 2
                                }))).await;
                                break;
                            }
                        }
                        event = subscription.events.recv() => {
                            let Some(event) = event else { break };
                            if event.sequence() > checkpoint.sequence
                                && !send(&callback, event.frame().to_vec()).await
                            {
                                break;
                            }
                        }
                    }
                }
                Ok(())
            }
            .await;
            if result.is_err() {
                let _ = send(
                    &callback,
                    frame(json!({
                        "latestSequence": 0, "reason": "sequence_gap", "sessionId": "",
                        "type": "resync.required", "version": 2
                    })),
                )
                .await;
            }
            task_registry.remove(&task_id);
        });

        Ok(NodeEventSubscription {
            cancellation,
            id,
            registry,
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{MAX_BRIDGE_FRAME_BYTES, frame};

    #[test]
    fn bridge_frame_is_bounded_and_serialized_once() {
        let bytes = frame(json!({ "sequence": 1, "type": "message.delta" }));
        assert!(bytes.len() < MAX_BRIDGE_FRAME_BYTES);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).expect("json")["sequence"],
            1
        );
    }
}
