use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
};

use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use tauri::{
    State,
    ipc::{Channel, Response},
};

use crate::{
    command_error::CommandError,
    commands::tasks::project,
    event_mailbox::{EventMailbox, clamp_pull_budget, encode_pull_batch},
};

#[derive(Clone, Copy, Serialize)]
pub struct EventAvailable {
    #[serde(rename = "type")]
    event_type: &'static str,
}

const EVENT_AVAILABLE: EventAvailable = EventAvailable {
    event_type: "event.available",
};

struct LiveSubscription {
    channel: Channel<EventAvailable>,
    mailbox: EventMailbox,
}

/// 每个订阅的 mailbox 与唤醒 Channel，关闭时必须一起释放。
pub struct EventDeliveryRegistry {
    inner: Mutex<HashMap<String, LiveSubscription>>,
}

impl EventDeliveryRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn insert(&self, id: String, mailbox: EventMailbox, channel: Channel<EventAvailable>) {
        self.lock()
            .insert(id, LiveSubscription { channel, mailbox });
    }

    fn get(&self, id: &str) -> Option<(EventMailbox, Channel<EventAvailable>)> {
        self.lock()
            .get(id)
            .map(|live| (live.mailbox.clone(), live.channel.clone()))
    }

    fn remove(&self, id: &str) -> bool {
        self.lock().remove(id).is_some_and(|live| {
            live.mailbox.close();
            true
        })
    }

    pub fn close_all(&self) {
        let mut inner = self.lock();
        for live in inner.values() {
            live.mailbox.close();
        }
        inner.clear();
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, LiveSubscription>> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSubscribeResponse {
    subscription_id: String,
}

fn send_available(channel: &Channel<EventAvailable>) -> bool {
    channel.send(EVENT_AVAILABLE).is_ok()
}

#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command 需要显式接收恢复坐标、lease 与唤醒 Channel"
)]
#[tauri::command]
pub async fn event_subscribe(
    request_id: String,
    project_id: String,
    lease_id: String,
    after_sequence: u64,
    session_id: String,
    channel: Channel<EventAvailable>,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
    deliveries: State<'_, Arc<EventDeliveryRegistry>>,
) -> Result<EventSubscribeResponse, CommandError> {
    let project_id = project(&project_id)?;
    let runtime = runtime.inner().clone();
    let deliveries = deliveries.inner().clone();
    let mailbox = EventMailbox::new();
    let send_mailbox = mailbox.clone();
    let send_channel = channel.clone();
    let subscription_id = runtime.start_leased_project_event_subscription(
        &tokio::runtime::Handle::current(),
        request_id,
        project_id,
        lease_id,
        session_id,
        after_sequence,
        move |frame| {
            let mailbox = send_mailbox.clone();
            let channel = send_channel.clone();
            async move {
                if !mailbox.admit(frame).await {
                    return false;
                }
                if mailbox.take_notify_hint() && !send_available(&channel) {
                    mailbox.close();
                    return false;
                }
                true
            }
        },
    )?;
    deliveries.insert(subscription_id.clone(), mailbox, channel);
    Ok(EventSubscribeResponse { subscription_id })
}

#[tauri::command]
pub fn event_pull(
    subscription_id: String,
    max_events: Option<u32>,
    max_bytes: Option<u32>,
    deliveries: State<'_, Arc<EventDeliveryRegistry>>,
) -> Result<Response, CommandError> {
    let Some((mailbox, channel)) = deliveries.get(&subscription_id) else {
        return Err(CommandError::not_found("event subscription was not found"));
    };
    mailbox.on_pull_started();
    let (max_events, max_bytes) = clamp_pull_budget(max_events, max_bytes);
    let frames = mailbox.pull(max_events, max_bytes);
    if mailbox.notify_if_remaining() && !send_available(&channel) {
        mailbox.close();
    }
    Ok(Response::new(encode_pull_batch(&frames)))
}

#[derive(Debug, Serialize)]
pub struct ProjectContextReleaseResponse {
    released: bool,
}

#[tauri::command]
pub async fn project_context_release(
    request_id: String,
    project_id: String,
    lease_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<ProjectContextReleaseResponse, CommandError> {
    let project_id = project(&project_id)?;
    let released = runtime
        .release_project_context_lease(&request_id, &project_id, &lease_id)
        .await?;
    Ok(ProjectContextReleaseResponse { released })
}

#[tauri::command]
pub async fn event_unsubscribe(
    subscription_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
    deliveries: State<'_, Arc<EventDeliveryRegistry>>,
) -> Result<bool, CommandError> {
    deliveries.remove(&subscription_id);
    Ok(runtime.cancel_event_subscription(&subscription_id))
}
