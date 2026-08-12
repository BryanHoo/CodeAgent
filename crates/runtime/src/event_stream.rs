use std::{collections::VecDeque, sync::Arc, time::Duration};

use chrono::{DateTime, SecondsFormat, Utc};
use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use code_agent_protocol::RawProviderEvent;
use serde_json::Value;
use tokio::{
    sync::{Mutex, mpsc, watch},
    time::{Instant, MissedTickBehavior},
};
use tokio_util::sync::CancellationToken;

/// 默认 Delta 合并窗口。
pub const DEFAULT_COALESCING_WINDOW: Duration = Duration::from_millis(16);

const APPEND_EVENT_TYPES: [&str; 4] = [
    "command.output_delta",
    "message.delta",
    "plan.delta",
    "reasoning.delta",
];
const REPLACE_EVENT_TYPES: [&str; 3] =
    ["file_change.updated", "tool.progress", "turn.diff_updated"];

/// Event Stream 数量与字节预算。
#[derive(Clone)]
pub struct EventStreamOptions {
    /// 最多保留的已发布事件数。
    pub capacity: usize,
    /// 单事件序列化字节上限。
    pub max_event_bytes: usize,
    /// 保留窗口总序列化字节上限。
    pub max_retained_bytes: usize,
    /// 可替换的 UTC 时钟。
    pub now: Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    /// Provider 展示名称。
    pub provider: Arc<str>,
    /// 当前 Project Runtime Session ID。
    pub session_id: Arc<str>,
    /// 每个订阅者的有界事件队列容量。
    pub subscriber_capacity: usize,
}

/// Snapshot 与事件流之间的恢复检查点。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventCheckpoint {
    /// 当前最新序号。
    pub sequence: u64,
    /// 当前 Session ID。
    pub session_id: Arc<str>,
}

/// 已分配 Runtime 传输信封并完成单次序列化的事件。
#[derive(Clone, Debug)]
pub struct PublishedEvent {
    frame: Arc<[u8]>,
    sequence: u64,
    value: Arc<Value>,
}

impl PublishedEvent {
    /// 返回事件序号。
    #[must_use]
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// 返回事件 JSON。
    #[must_use]
    pub fn value(&self) -> &Value {
        &self.value
    }

    /// 返回可直接交付 Delivery 的序列化 frame。
    #[must_use]
    pub fn frame(&self) -> &[u8] {
        &self.frame
    }
}

/// 回放结果或必须重读 Snapshot 的原因。
#[derive(Clone, Debug)]
pub enum EventReplay {
    /// 连续保留的事件。
    Events(Vec<Arc<PublishedEvent>>),
    /// 当前 checkpoint 不再可连续恢复。
    Resync {
        /// 当前最新序号。
        latest_sequence: u64,
        /// 稳定重同步原因。
        reason: &'static str,
    },
}

/// 独立于事件队列的订阅者控制信号。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubscriberSignal {
    /// 正常接收事件。
    Ready,
    /// 事件队列已产生缺口，必须重读 Snapshot。
    ResyncRequired,
}

/// 单个有界订阅。
pub struct EventSubscription {
    /// 有界事件 receiver。
    pub events: mpsc::Receiver<Arc<PublishedEvent>>,
    /// 慢消费者重同步控制信号。
    pub signal: watch::Receiver<SubscriberSignal>,
}

/// Event Stream 累计与当前状态指标。
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct EventStreamMetrics {
    /// 被合并的 Provider 事件数。
    pub coalesced_events: u64,
    /// Provider 输入事件数。
    pub provider_events_received: u64,
    /// 已分配序号的事件数。
    pub published_events: u64,
    /// 当前保留事件数。
    pub retained_events: usize,
    /// 因数量或字节预算发生的淘汰数。
    pub retention_evictions: u64,
    /// 因事件队列已满而要求重同步的订阅数。
    pub slow_subscribers: u64,
}

struct RetainedEvent {
    bytes: usize,
    event: Arc<PublishedEvent>,
}

struct Subscriber {
    events: mpsc::Sender<Arc<PublishedEvent>>,
    signal: watch::Sender<SubscriberSignal>,
}

struct EventStreamState {
    closed: bool,
    history_floor_sequence: u64,
    metrics: EventStreamMetrics,
    next_subscriber_id: u64,
    pending: Vec<RawProviderEvent>,
    retained: VecDeque<RetainedEvent>,
    retained_bytes: usize,
    sequence: u64,
    subscribers: Vec<(u64, Subscriber)>,
}

/// 有界、按序且支持恢复的 Project Agent Event Stream。
pub struct AgentEventStream {
    options: EventStreamOptions,
    state: Mutex<EventStreamState>,
}

impl AgentEventStream {
    /// 创建 Event Stream。
    pub fn new(options: EventStreamOptions) -> Result<Self, CodeAgentError> {
        if options.capacity == 0
            || options.max_event_bytes == 0
            || options.max_retained_bytes == 0
            || options.subscriber_capacity == 0
            || options.session_id.is_empty()
            || options.provider.is_empty()
        {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::InvalidInput,
                "event stream capacities, provider and session must be non-empty",
                None,
            ));
        }
        Ok(Self {
            options,
            state: Mutex::new(EventStreamState {
                closed: false,
                history_floor_sequence: 0,
                metrics: EventStreamMetrics::default(),
                next_subscriber_id: 0,
                pending: Vec::new(),
                retained: VecDeque::new(),
                retained_bytes: 0,
                sequence: 0,
                subscribers: Vec::new(),
            }),
        })
    }

    /// 发布 Provider Event；关键事件先冲刷更早 Delta。
    pub async fn publish(&self, event: RawProviderEvent) {
        let mut state = self.state.lock().await;
        if state.closed {
            return;
        }
        state.metrics.provider_events_received += 1;
        if !is_coalesced_event(&event) {
            self.flush_locked(&mut state);
            self.publish_now(&mut state, event);
            return;
        }

        let previous = state.pending.last_mut();
        if let Some(previous) =
            previous.filter(|previous| coalescing_key(previous) == coalescing_key(&event))
        {
            merge_event(previous, event);
            state.metrics.coalesced_events += 1;
        } else {
            state.pending.push(event);
        }
    }

    /// 冲刷当前窗口内的全部 Delta。
    pub async fn flush(&self) {
        let mut state = self.state.lock().await;
        self.flush_locked(&mut state);
    }

    /// 按默认窗口冲刷 Delta，关闭信号到达时执行最后一次冲刷。
    pub async fn run_flush_loop(&self, shutdown: CancellationToken) {
        let start = Instant::now() + DEFAULT_COALESCING_WINDOW;
        let mut interval = tokio::time::interval_at(start, DEFAULT_COALESCING_WINDOW);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = shutdown.cancelled() => {
                    self.flush().await;
                    return;
                }
                _ = interval.tick() => self.flush().await,
            }
        }
    }

    /// 返回覆盖所有已接收事件的 checkpoint。
    pub async fn checkpoint(&self) -> EventCheckpoint {
        let mut state = self.state.lock().await;
        self.flush_locked(&mut state);
        EventCheckpoint {
            sequence: state.sequence,
            session_id: self.options.session_id.clone(),
        }
    }

    /// 回放指定 checkpoint 后连续保留的事件。
    pub async fn replay_after(&self, session_id: &str, sequence: u64) -> EventReplay {
        let mut state = self.state.lock().await;
        self.flush_locked(&mut state);
        if session_id != self.options.session_id.as_ref() {
            return EventReplay::Resync {
                latest_sequence: state.sequence,
                reason: "session_changed",
            };
        }
        if sequence > state.sequence {
            return EventReplay::Resync {
                latest_sequence: state.sequence,
                reason: "sequence_gap",
            };
        }
        if sequence < state.history_floor_sequence {
            return EventReplay::Resync {
                latest_sequence: state.sequence,
                reason: "event_retention_exceeded",
            };
        }
        EventReplay::Events(
            state
                .retained
                .iter()
                .filter(|retained| retained.event.sequence > sequence)
                .map(|retained| retained.event.clone())
                .collect(),
        )
    }

    /// 创建独立有界订阅。
    pub async fn subscribe(&self) -> Result<EventSubscription, CodeAgentError> {
        let mut state = self.state.lock().await;
        if state.closed {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::ShuttingDown,
                "event stream is closed",
                None,
            ));
        }
        let (events_sender, events) = mpsc::channel(self.options.subscriber_capacity);
        let (signal_sender, signal) = watch::channel(SubscriberSignal::Ready);
        let subscriber_id = state.next_subscriber_id;
        state.next_subscriber_id += 1;
        state.subscribers.push((
            subscriber_id,
            Subscriber {
                events: events_sender,
                signal: signal_sender,
            },
        ));
        Ok(EventSubscription { events, signal })
    }

    /// 返回不包含业务载荷的 Event Stream 指标。
    pub async fn metrics(&self) -> EventStreamMetrics {
        let state = self.state.lock().await;
        EventStreamMetrics {
            retained_events: state.retained.len(),
            ..state.metrics
        }
    }

    /// 冲刷并关闭 Stream，释放全部订阅。
    pub async fn close(&self) {
        let mut state = self.state.lock().await;
        if state.closed {
            return;
        }
        self.flush_locked(&mut state);
        state.closed = true;
        state.subscribers.clear();
    }

    fn flush_locked(&self, state: &mut EventStreamState) {
        let pending = std::mem::take(&mut state.pending);
        for event in pending {
            self.publish_now(state, event);
        }
    }

    fn publish_now(&self, state: &mut EventStreamState, event: RawProviderEvent) {
        state.sequence += 1;
        let sequence = state.sequence;
        let mut value = event.into_value();
        if let Some(object) = value.as_object_mut() {
            object.insert(
                "provider".to_owned(),
                Value::String(self.options.provider.to_string()),
            );
            object.insert("sequence".to_owned(), Value::from(sequence));
            object.insert(
                "sessionId".to_owned(),
                Value::String(self.options.session_id.to_string()),
            );
            object.insert(
                "timestamp".to_owned(),
                Value::String((self.options.now)().to_rfc3339_opts(SecondsFormat::Millis, true)),
            );
            object.insert("version".to_owned(), Value::from(2));
        }
        let Ok(frame) = serde_json::to_vec(&value) else {
            return;
        };
        let event = Arc::new(PublishedEvent {
            frame: Arc::from(frame),
            sequence,
            value: Arc::new(value),
        });
        self.retain(state, event.clone());
        state.metrics.published_events += 1;

        state.subscribers.retain(|(_, subscriber)| {
            if subscriber.events.try_send(event.clone()).is_ok() {
                true
            } else {
                subscriber
                    .signal
                    .send_replace(SubscriberSignal::ResyncRequired);
                state.metrics.slow_subscribers += 1;
                false
            }
        });
    }

    fn retain(&self, state: &mut EventStreamState, event: Arc<PublishedEvent>) {
        let bytes = event.frame.len();
        if bytes > self.options.max_event_bytes || bytes > self.options.max_retained_bytes {
            while state.retained.pop_front().is_some() {
                state.metrics.retention_evictions += 1;
            }
            state.retained_bytes = 0;
            state.history_floor_sequence = event.sequence;
            state.metrics.retention_evictions += 1;
            return;
        }
        while state.retained.len() >= self.options.capacity
            || state.retained_bytes + bytes > self.options.max_retained_bytes
        {
            let Some(oldest) = state.retained.pop_front() else {
                break;
            };
            state.retained_bytes -= oldest.bytes;
            state.history_floor_sequence = oldest.event.sequence;
            state.metrics.retention_evictions += 1;
        }
        state.retained_bytes += bytes;
        state.retained.push_back(RetainedEvent { bytes, event });
    }
}

fn is_coalesced_event(event: &RawProviderEvent) -> bool {
    APPEND_EVENT_TYPES.contains(&event.event_type())
        || REPLACE_EVENT_TYPES.contains(&event.event_type())
}

#[derive(Eq, PartialEq)]
struct CoalescingKey<'a> {
    event_type: &'a str,
    field: Option<&'a str>,
    item_id: Option<&'a str>,
    section_index: Option<u64>,
    task_id: &'a str,
    turn_id: Option<&'a str>,
}

fn coalescing_key(event: &RawProviderEvent) -> CoalescingKey<'_> {
    CoalescingKey {
        event_type: event.event_type(),
        field: event.as_value()["payload"]["field"].as_str(),
        item_id: event.item_id(),
        section_index: event.as_value()["payload"]["sectionIndex"].as_u64(),
        task_id: event.task_id(),
        turn_id: event.turn_id(),
    }
}

fn merge_event(previous: &mut RawProviderEvent, current: RawProviderEvent) {
    if APPEND_EVENT_TYPES.contains(&current.event_type()) {
        let delta = current.as_value()["payload"]["delta"]
            .as_str()
            .unwrap_or_default();
        previous.append_delta(delta);
    } else {
        *previous = current;
    }
}
