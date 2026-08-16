use std::{sync::Arc, time::Duration};

use chrono::DateTime;
use code_agent_protocol::parse_provider_event;
use code_agent_runtime::{
    AgentEventStream, DEFAULT_COALESCING_WINDOW, EventReplay, EventStreamOptions, PublishedEvent,
    SubscriberSignal,
};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

fn event(value: Value) -> code_agent_protocol::ProviderEvent {
    parse_provider_event(value).expect("valid provider event")
}

fn published_value(event: &PublishedEvent) -> Value {
    serde_json::from_slice(event.frame()).expect("valid published event frame")
}

fn message_delta(item_id: &str, delta: &str) -> code_agent_protocol::ProviderEvent {
    event(json!({
        "itemId": item_id,
        "payload": { "delta": delta },
        "taskId": "task-1",
        "turnId": "turn-1",
        "type": "message.delta"
    }))
}

fn completed() -> code_agent_protocol::ProviderEvent {
    event(json!({
        "payload": {
            "turn": {
                "completedAt": "2026-08-12T00:00:01Z",
                "error": null,
                "id": "turn-1",
                "items": [],
                "startedAt": "2026-08-12T00:00:00Z",
                "status": "completed"
            }
        },
        "taskId": "task-1",
        "turnId": "turn-1",
        "type": "turn.completed"
    }))
}

fn reasoning_delta(section_index: u64, delta: &str) -> code_agent_protocol::ProviderEvent {
    event(json!({
        "itemId": "reasoning-1",
        "payload": {
            "delta": delta,
            "field": "summary",
            "sectionIndex": section_index
        },
        "taskId": "task-1",
        "turnId": "turn-1",
        "type": "reasoning.delta"
    }))
}

fn options() -> EventStreamOptions {
    EventStreamOptions {
        capacity: 3,
        max_event_bytes: 1_024,
        max_retained_bytes: 4_096,
        now: Arc::new(|| DateTime::UNIX_EPOCH),
        provider: Arc::from("fake"),
        session_id: Arc::from("session-1"),
        subscriber_capacity: 4,
    }
}

#[test]
fn default_coalescing_window_should_balance_latency_and_publish_rate() {
    assert!(
        (Duration::from_millis(4)..=Duration::from_millis(8)).contains(&DEFAULT_COALESCING_WINDOW)
    );
}

#[test]
fn published_event_should_only_own_frame_and_sequence() {
    assert_eq!(
        std::mem::size_of::<PublishedEvent>(),
        std::mem::size_of::<Arc<[u8]>>() + std::mem::size_of::<u64>()
    );
}

#[tokio::test]
async fn event_stream_should_publish_first_delta_without_waiting_for_flush_window() {
    let stream = AgentEventStream::new(options()).expect("stream");
    let mut subscriber = stream.subscribe().await.expect("subscriber");

    stream.publish(message_delta("item-a", "visible")).await;

    let published = subscriber.events.try_recv().expect("first delta published");
    assert_eq!(published_value(&published)["payload"]["delta"], "visible");
}

#[tokio::test]
async fn event_stream_should_serialize_provider_event_and_transport_envelope_together() {
    let stream = AgentEventStream::new(options()).expect("stream");
    let mut subscriber = stream.subscribe().await.expect("subscriber");

    stream.publish(message_delta("item-a", "visible")).await;

    let published = subscriber.events.recv().await.expect("published event");
    assert_eq!(
        published_value(&published),
        json!({
            "itemId": "item-a",
            "payload": { "delta": "visible" },
            "provider": "fake",
            "sequence": 1,
            "sessionId": "session-1",
            "taskId": "task-1",
            "timestamp": "1970-01-01T00:00:00.000Z",
            "turnId": "turn-1",
            "type": "message.delta",
            "version": 2
        })
    );
}

#[tokio::test]
async fn event_stream_should_coalesce_adjacent_delta_and_flush_before_terminal() {
    let stream = AgentEventStream::new(options()).expect("stream");
    let mut subscriber = stream.subscribe().await.expect("subscriber");

    stream.publish(message_delta("item-a", "visible")).await;
    stream.publish(message_delta("item-a", "hel")).await;
    stream.publish(message_delta("item-a", "lo")).await;
    stream.publish(completed()).await;

    let leading = subscriber.events.recv().await.expect("leading delta");
    let trailing = subscriber.events.recv().await.expect("trailing delta");
    let terminal = subscriber.events.recv().await.expect("terminal");
    assert_eq!(published_value(&leading)["payload"]["delta"], "visible");
    assert_eq!(published_value(&trailing)["payload"]["delta"], "hello");
    assert_eq!(terminal.sequence(), 3);
    assert_eq!(published_value(&terminal)["type"], "turn.completed");
}

#[tokio::test]
async fn event_stream_should_report_live_and_accumulated_metrics() {
    let stream = AgentEventStream::new(options()).expect("stream");
    let _subscriber = stream.subscribe().await.expect("subscriber");

    stream.publish(message_delta("item-a", "hel")).await;
    stream.publish(message_delta("item-a", "lo")).await;
    stream.publish(message_delta("item-a", "!")).await;

    let pending = stream.metrics().await;
    assert_eq!(pending.provider_events_received, 3);
    assert_eq!(pending.coalesced_events, 1);
    assert_eq!(pending.pending_deltas, 1);
    assert_eq!(pending.published_events, 1);
    assert_eq!(pending.queue_high_water_mark, 1);

    stream.flush().await;
    let published = stream.metrics().await;
    assert_eq!(published.pending_deltas, 0);
    assert_eq!(published.published_events, 2);
    assert_eq!(published.queue_high_water_mark, 2);
    assert_eq!(published.retained_events, 2);
}

#[tokio::test]
async fn event_stream_should_preserve_a_b_a_order() {
    let stream = AgentEventStream::new(options()).expect("stream");
    stream.publish(message_delta("item-a", "one")).await;
    stream.publish(message_delta("item-b", "two")).await;
    stream.publish(message_delta("item-a", "three")).await;
    stream.flush().await;

    let EventReplay::Events(events) = stream.replay_after("session-1", 0).await else {
        panic!("expected events")
    };
    let item_ids = events
        .iter()
        .map(|published| {
            published_value(published)["itemId"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        })
        .collect::<Vec<_>>();
    assert_eq!(item_ids, ["item-a", "item-b", "item-a"]);
}

#[tokio::test]
async fn event_stream_should_not_merge_different_reasoning_sections() {
    let stream = AgentEventStream::new(options()).expect("stream");
    stream.publish(reasoning_delta(0, "one")).await;
    stream.publish(reasoning_delta(1, "two")).await;
    stream.flush().await;

    let EventReplay::Events(events) = stream.replay_after("session-1", 0).await else {
        panic!("expected events")
    };
    assert_eq!(events.len(), 2);
    assert_eq!(published_value(&events[0])["payload"]["sectionIndex"], 0);
    assert_eq!(published_value(&events[1])["payload"]["sectionIndex"], 1);
}

#[tokio::test]
async fn event_stream_should_flush_delta_on_default_window() {
    let stream = Arc::new(AgentEventStream::new(options()).expect("stream"));
    let mut subscriber = stream.subscribe().await.expect("subscriber");
    let shutdown = CancellationToken::new();
    let flush_stream = stream.clone();
    let flush_shutdown = shutdown.clone();
    let flush_task = tokio::spawn(async move {
        flush_stream.run_flush_loop(flush_shutdown).await;
    });

    stream.publish(message_delta("item-a", "visible")).await;
    let leading = subscriber.events.recv().await.expect("leading delta");
    assert_eq!(published_value(&leading)["payload"]["delta"], "visible");

    stream.publish(message_delta("item-a", "windowed")).await;
    let published = tokio::time::timeout(Duration::from_millis(100), subscriber.events.recv())
        .await
        .expect("default window elapsed")
        .expect("published event");
    assert_eq!(published_value(&published)["payload"]["delta"], "windowed");

    stream.publish(message_delta("item-a", "next-window")).await;
    assert!(subscriber.events.try_recv().is_err());
    let next = tokio::time::timeout(Duration::from_millis(100), subscriber.events.recv())
        .await
        .expect("next window elapsed")
        .expect("next published event");
    assert_eq!(published_value(&next)["payload"]["delta"], "next-window");

    shutdown.cancel();
    flush_task.await.expect("flush task");
}

#[tokio::test]
async fn event_stream_should_start_flush_timer_only_when_delta_is_pending() {
    let stream = Arc::new(AgentEventStream::new(options()).expect("stream"));
    let mut subscriber = stream.subscribe().await.expect("subscriber");
    let shutdown = CancellationToken::new();
    let flush_stream = Arc::clone(&stream);
    let flush_shutdown = shutdown.clone();
    let flush_task = tokio::spawn(async move {
        flush_stream.run_flush_loop(flush_shutdown).await;
    });

    stream.publish(message_delta("item-a", "leading")).await;
    subscriber.events.recv().await.expect("leading delta");
    tokio::time::sleep(DEFAULT_COALESCING_WINDOW * 3).await;

    stream.publish(message_delta("item-a", "pending")).await;
    assert!(subscriber.events.try_recv().is_err());
    let trailing = tokio::time::timeout(DEFAULT_COALESCING_WINDOW * 3, subscriber.events.recv())
        .await
        .expect("flush timer elapsed")
        .expect("trailing delta");
    assert_eq!(published_value(&trailing)["payload"]["delta"], "pending");
    shutdown.cancel();
    flush_task.await.expect("flush task");
}

#[tokio::test]
async fn event_stream_should_require_resync_for_session_and_retention_gaps() {
    let mut constrained = options();
    constrained.capacity = 1;
    let stream = AgentEventStream::new(constrained).expect("stream");
    stream.publish(completed()).await;
    stream.publish(completed()).await;

    assert!(matches!(
        stream.replay_after("old-session", 0).await,
        EventReplay::Resync {
            reason: "session_changed",
            ..
        }
    ));
    assert!(matches!(
        stream.replay_after("session-1", 99).await,
        EventReplay::Resync {
            reason: "sequence_gap",
            ..
        }
    ));
    assert!(matches!(
        stream.replay_after("session-1", 0).await,
        EventReplay::Resync {
            reason: "event_retention_exceeded",
            ..
        }
    ));
}

#[tokio::test]
async fn event_stream_should_enforce_single_event_and_total_byte_budgets() {
    let mut constrained = options();
    constrained.max_event_bytes = 200;
    constrained.max_retained_bytes = 200;
    let stream = AgentEventStream::new(constrained).expect("stream");

    stream
        .publish(message_delta("item-a", &"x".repeat(500)))
        .await;
    stream.flush().await;

    assert!(matches!(
        stream.replay_after("session-1", 0).await,
        EventReplay::Resync {
            reason: "event_retention_exceeded",
            ..
        }
    ));
}

#[tokio::test]
async fn event_stream_should_signal_slow_subscriber_without_blocking_publish() {
    let mut constrained = options();
    constrained.subscriber_capacity = 1;
    let stream = AgentEventStream::new(constrained).expect("stream");
    let mut subscriber = stream.subscribe().await.expect("subscriber");

    tokio::time::timeout(Duration::from_millis(100), async {
        stream.publish(completed()).await;
        stream.publish(completed()).await;
    })
    .await
    .expect("publish remains non-blocking");

    subscriber.signal.changed().await.expect("signal");
    assert_eq!(
        *subscriber.signal.borrow(),
        SubscriberSignal::ResyncRequired
    );
    let metrics = stream.metrics().await;
    assert_eq!(metrics.slow_subscribers, 1);
}

#[tokio::test]
async fn event_stream_should_signal_all_subscribers_when_provider_overflows() {
    let stream = AgentEventStream::new(options()).expect("stream");
    let mut first = stream.subscribe().await.expect("first subscriber");
    let mut second = stream.subscribe().await.expect("second subscriber");

    stream.require_resync().await;

    first.signal.changed().await.expect("first signal");
    second.signal.changed().await.expect("second signal");
    assert_eq!(*first.signal.borrow(), SubscriberSignal::ResyncRequired);
    assert_eq!(*second.signal.borrow(), SubscriberSignal::ResyncRequired);
}

#[tokio::test]
async fn event_stream_should_flush_before_checkpoint_and_close() {
    let stream = AgentEventStream::new(options()).expect("stream");
    stream.publish(message_delta("item-a", "pending")).await;

    let checkpoint = stream.checkpoint().await;
    assert_eq!(checkpoint.sequence, 1);
    stream.close().await;
    stream.publish(completed()).await;
    assert_eq!(stream.checkpoint().await.sequence, 1);
}
