use std::sync::Arc;

use code_agent_runtime::CodeAgentRuntime;
use napi::{
    Status,
    bindgen_prelude::{Buffer, Function},
    threadsafe_function::ThreadsafeFunction,
};
use napi_derive::napi;
use serde_json::json;

use crate::{NodeEngine, operations::project_id};

type EventCallback = ThreadsafeFunction<Vec<u8>, (), Buffer, Status, false, true, 1>;
const MAX_BRIDGE_FRAME_BYTES: usize = 1024 * 1024;

#[napi]
pub struct NodeEventSubscription {
    id: String,
    runtime: Arc<CodeAgentRuntime>,
}

#[napi]
impl NodeEventSubscription {
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[napi]
    pub fn unsubscribe(&self) -> bool {
        self.runtime.cancel_event_subscription(&self.id)
    }
}

#[cfg(any(feature = "performance-probe", test))]
fn frame(value: serde_json::Value) -> Arc<[u8]> {
    Arc::from(serde_json::to_vec(&value).unwrap_or_default())
}

async fn send(callback: &EventCallback, bytes: Arc<[u8]>) -> bool {
    bytes.len() <= MAX_BRIDGE_FRAME_BYTES && callback.call_async(bytes.to_vec()).await.is_ok()
}

#[cfg(feature = "performance-probe")]
#[napi]
pub fn performance_event_bridge(
    events: u32,
    callback: Function<'_, Buffer, ()>,
) -> napi::Result<()> {
    if events == 0 || events > 1_000_000 {
        return Err(crate::errors::invalid_input(
            "events must be between 1 and 1000000",
        ));
    }
    let callback = callback
        .build_threadsafe_function::<Vec<u8>>()
        .weak::<true>()
        .max_queue_size::<1>()
        .build_callback(|context| Ok(Buffer::from(context.value)))?;

    napi::bindgen_prelude::spawn(async move {
        for sequence in 1..=events {
            let bytes = frame(json!({
                "payload": { "code": "runtime_warning", "level": "info", "message": "performance" },
                "provider": "codex",
                "sequence": sequence,
                "sessionId": "session-performance",
                "taskId": "task-performance",
                "timestamp": "2026-08-14T00:00:00.000Z",
                "type": "task.notice",
                "version": 2
            }));
            if !send(&callback, bytes).await {
                break;
            }
        }
    });
    Ok(())
}

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn event_metrics_get(&self, request_id: String) -> napi::Result<serde_json::Value> {
        let projects = self
            .runtime()
            .event_stream_metrics(&request_id)
            .await
            .map_err(crate::errors::to_napi_error)?
            .into_iter()
            .map(|(project_id, metrics)| {
                json!({
                    "coalescedEvents": metrics.coalesced_events,
                    "pendingDeltas": metrics.pending_deltas,
                    "projectId": project_id.as_str(),
                    "providerEventsReceived": metrics.provider_events_received,
                    "publishedEvents": metrics.published_events,
                    "queueHighWaterMark": metrics.queue_high_water_mark,
                    "retainedEvents": metrics.retained_events,
                    "retentionEvictions": metrics.retention_evictions,
                    "slowSubscribers": metrics.slow_subscribers,
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({ "projects": projects }))
    }

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
        let runtime = self.runtime_arc();
        let callback = Arc::new(callback);
        let id = runtime
            .start_project_event_subscription(
                self.runtime_handle(),
                request_id,
                project,
                session_id,
                after_sequence,
                move |frame| {
                    let callback = Arc::clone(&callback);
                    async move { send(&callback, frame).await }
                },
            )
            .map_err(crate::errors::to_napi_error)?;

        Ok(NodeEventSubscription { id, runtime })
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
