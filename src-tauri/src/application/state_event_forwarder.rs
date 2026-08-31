use std::sync::Arc;

use serde_json::{Value, json};
use tauri::AppHandle;
use tokio::{
    sync::{Mutex, mpsc},
    task::JoinHandle,
    time::{Instant, sleep_until},
};

use super::super::{
    desktop_pet_commands::render_desktop_pet_task_activities, error::AppError,
    notification_commands::observe_task_notification,
    task_subscription_commands::spawn_task_subscription_release,
    tray_commands::render_tray_task_activities,
};
use super::{
    RuntimeSession,
    event_delta_batcher::{BatchAction, DeltaBatcher},
    runtime_supervisor::{prepare_runtime_restart, schedule_runtime_restart},
};
use crate::{
    domain::runtime::{AgentEvent, AppEvent, ProviderKind, RuntimeStatus},
    infrastructure::codex::{MappedServerRequest, PendingServerRequest, ServerMessage},
};

pub(super) fn spawn_event_forwarder(
    runtime: Arc<Mutex<RuntimeSession>>,
    mut messages: mpsc::Receiver<ServerMessage>,
    app: Option<AppHandle>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut batcher = DeltaBatcher::new();
        loop {
            let message = if let Some(deadline) = batcher.deadline() {
                tokio::select! {
                    message = messages.recv() => message,
                    _ = sleep_until(deadline) => {
                        if let Some(event) = batcher.flush(Instant::now())
                            && !publish_mapped_event(&runtime, event, None, app.as_ref()).await
                        {
                            break;
                        }
                        continue;
                    }
                }
            } else {
                messages.recv().await
            };
            let Some(message) = message else {
                break;
            };

            // JSON 建树和协议映射可能随 delta 体积增长，必须在全局状态锁之外完成。
            observe_model_turn(&runtime, &message).await;
            if handle_login_notification(&runtime, &message).await {
                continue;
            }
            if handle_mcp_status(&runtime, &message).await == McpStatusAction::CachedOnly {
                continue;
            }
            if message.method == "serverRequest/resolved" {
                if let Some(event) = batcher.flush_boundary()
                    && !publish_mapped_event(&runtime, event, None, app.as_ref()).await
                {
                    break;
                }
                if !handle_resolved_request(&runtime, &message).await {
                    break;
                }
                continue;
            }

            let Some((event, pending)) = map_message(message) else {
                continue;
            };

            match batcher.push(event, Instant::now()) {
                BatchAction::Buffered => {}
                BatchAction::Publish(event) => {
                    if !publish_mapped_event(&runtime, event, pending, app.as_ref()).await {
                        break;
                    }
                }
                BatchAction::PublishThen(first, second) => {
                    if !publish_mapped_event(&runtime, first, None, app.as_ref()).await
                        || !publish_mapped_event(&runtime, second, pending, app.as_ref()).await
                    {
                        break;
                    }
                }
            }
        }

        if let Some(event) = batcher.flush_boundary() {
            let _ = publish_mapped_event(&runtime, event, None, app.as_ref()).await;
        }

        finish_runtime(&runtime, app.as_ref()).await;
    })
}

async fn publish_mapped_event(
    runtime: &Arc<Mutex<RuntimeSession>>,
    mut event: AgentEvent,
    mut pending: Option<PendingServerRequest>,
    app: Option<&AppHandle>,
) -> bool {
    let Some(task_id) = event.task_id().map(str::to_owned) else {
        return true;
    };

    // 序号只在实际发布时分配，合并后的 delta 不会制造 checkpoint 空洞。
    let mut session = runtime.lock().await;
    let Some(project_id) = session.task_projects.get(&task_id).cloned() else {
        return true;
    };
    if let Some(pending) = pending.as_mut() {
        pending.request["projectId"] = json!(project_id);
        let Some(event_json) = event.as_json_mut() else {
            return true;
        };
        event_json["payload"]["request"]["projectId"] = json!(project_id);
    }
    let activity_changed = session.task_activity.apply_event(&project_id, &event);
    let release_generation = if event.event_type() == Some("turn.started") {
        session.task_subscription_leases.retain(&task_id);
        None
    } else if is_terminal_task_event(&event) {
        Some(session.task_subscription_leases.release(&task_id))
    } else {
        None
    };
    let task_name = session.task_activity.task_name(&task_id).map(str::to_owned);
    let task_activities = activity_changed.then(|| session.task_activity.snapshot());
    if event.event_type() == Some("task.removed") {
        session.task_projects.remove(&task_id);
    }
    let sequence = session
        .project_sequences
        .entry(project_id.clone())
        .or_default();
    *sequence += 1;
    event.set_sequence(*sequence);
    if event.event_type() == Some("turn.started")
        && let Some(turn) = event
            .as_json()
            .and_then(|event| event.pointer("/payload/turn"))
    {
        session.turn_started_waiters.resolve(&task_id, turn);
    }
    if let Some(pending) = pending {
        let Some(request_id) = pending
            .request
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return true;
        };
        session.pending_requests.insert(request_id, pending);
    }
    // WebView 消费变慢时使用有界队列背压，Sequence 已分配后禁止静默丢弃事件。
    let pet_event = event.clone();
    let provider_event_count = event.source_event_count();
    let event_sender = session.event_sender.clone();
    let queue_depth = event_sender.as_ref().map_or(0, |sender| {
        (sender.max_capacity().saturating_sub(sender.capacity()) + 1).min(sender.max_capacity())
    });
    session
        .performance_metrics
        .record_delivery(&project_id, provider_event_count, 1, queue_depth);
    drop(session);
    if let Some(app) = app {
        // 原生后台状态必须先于 WebView 队列更新，窗口销毁或背压都不能阻塞托盘与通知。
        if let Some(task_activities) = task_activities.as_deref() {
            if let Err(error) = render_tray_task_activities(app, task_activities) {
                eprintln!("failed to update tray from runtime event: {error}");
            }
            if let Err(error) = render_desktop_pet_task_activities(app, task_activities).await {
                eprintln!("failed to update desktop pet from runtime event: {error}");
            }
        }
        observe_task_notification(app, &pet_event, task_name.as_deref()).await;
        if let Some(generation) = release_generation {
            // 终态释放由 Rust 事件源触发，窗口销毁后仍会持续处理 busy 重试。
            spawn_task_subscription_release(
                app.clone(),
                project_id.clone(),
                task_id.clone(),
                generation,
            );
        }
    }
    if let Some(sender) = event_sender {
        // 等待前已释放全局状态锁，慢 WebView 不会阻塞其他命令读取 Runtime 状态。
        let _ = sender.send(AppEvent::AgentEvent { event }).await;
    }
    true
}

fn is_terminal_task_event(event: &AgentEvent) -> bool {
    match event.event_type() {
        Some("turn.completed") => true,
        Some("provider.error") => {
            event
                .as_json()
                .and_then(|event| event.pointer("/payload/willRetry"))
                .and_then(Value::as_bool)
                == Some(false)
        }
        Some("task.status_updated") => {
            event
                .as_json()
                .and_then(|event| event.pointer("/payload/status"))
                .and_then(Value::as_str)
                == Some("failed")
        }
        _ => false,
    }
}

async fn observe_model_turn(runtime: &Arc<Mutex<RuntimeSession>>, message: &ServerMessage) {
    if matches!(message.method.as_str(), "item/completed" | "turn/completed")
        && let Ok(params) = serde_json::from_str::<Value>(message.params.get())
    {
        // 内部临时 Turn 不进入任务列表，只提取最终模型输出。
        runtime
            .lock()
            .await
            .model_turn_waiters
            .observe(&message.method, &params);
    }
}

async fn handle_login_notification(
    runtime: &Arc<Mutex<RuntimeSession>>,
    message: &ServerMessage,
) -> bool {
    if message.id.is_some() || message.method != "account/login/completed" {
        return false;
    }
    let Ok(params) = serde_json::from_str::<Value>(message.params.get()) else {
        return true;
    };
    let mut session = runtime.lock().await;
    if params.get("success").and_then(Value::as_bool) == Some(true) {
        session.provider_login = None;
    } else {
        let login_id = params
            .get("loginId")
            .and_then(Value::as_str)
            .or_else(|| {
                session
                    .provider_login
                    .as_ref()
                    .and_then(|value| value.get("loginId"))
                    .and_then(Value::as_str)
            })
            .unwrap_or("unknown");
        session.provider_login = Some(json!({
            "error": params.get("error").and_then(Value::as_str).unwrap_or("Login failed"),
            "loginId": login_id,
            "state": "failed"
        }));
    }
    true
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum McpStatusAction {
    NotApplicable,
    CachedOnly,
    CachedAndForward,
}

async fn handle_mcp_status(
    runtime: &Arc<Mutex<RuntimeSession>>,
    message: &ServerMessage,
) -> McpStatusAction {
    if message.id.is_some() || message.method != "mcpServer/startupStatus/updated" {
        return McpStatusAction::NotApplicable;
    }
    let Ok(params) = serde_json::from_str::<Value>(message.params.get()) else {
        return McpStatusAction::CachedOnly;
    };
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return McpStatusAction::CachedOnly;
    };
    let thread = params
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("*");
    let action = if thread == "*" {
        McpStatusAction::CachedOnly
    } else {
        McpStatusAction::CachedAndForward
    };
    runtime
        .lock()
        .await
        .mcp_statuses
        .insert(format!("{thread}\0{name}"), params);
    action
}

async fn handle_resolved_request(
    runtime: &Arc<Mutex<RuntimeSession>>,
    message: &ServerMessage,
) -> bool {
    let request_id = match crate::infrastructure::codex::resolved_request_id(message) {
        Ok(Some(request_id)) => request_id,
        Ok(None) => return true,
        Err(error) => {
            eprintln!("failed to map resolved codex request: {error}");
            return true;
        }
    };
    let pending = runtime.lock().await.pending_requests.remove(&request_id);
    let Some(pending) = pending else {
        return true;
    };
    let Ok((project_id, event)) = map_terminal_request(pending, "expired") else {
        return false;
    };
    let mut session = runtime.lock().await;
    let _ = publish_terminal_event(&mut session, project_id, event);
    true
}

fn map_message(message: ServerMessage) -> Option<(AgentEvent, Option<PendingServerRequest>)> {
    if message.id.is_some() {
        match crate::infrastructure::codex::map_server_request_now(message, 0) {
            Ok(Some(mapped)) => {
                let mapped: MappedServerRequest = mapped;
                Some((mapped.event.into(), Some(mapped.pending)))
            }
            Ok(None) => None,
            Err(error) => {
                eprintln!("failed to map codex request: {error}");
                None
            }
        }
    } else {
        match crate::infrastructure::codex::map_server_event_now(message, 0) {
            Ok(Some(event)) => Some((event, None)),
            Ok(None) => None,
            Err(error) => {
                eprintln!("failed to map codex event: {error}");
                None
            }
        }
    }
}

async fn finish_runtime(runtime: &Arc<Mutex<RuntimeSession>>, app: Option<&AppHandle>) {
    let pending = {
        let mut session = runtime.lock().await;
        session.codex_process = None;
        session._event_task = None;
        session.turn_started_waiters.clear();
        session.model_turn_waiters.clear();
        std::mem::take(&mut session.pending_requests)
    };
    let terminal_events = pending
        .into_values()
        .filter_map(|request| map_terminal_request(request, "expired").ok())
        .collect::<Vec<_>>();
    let mut session = runtime.lock().await;
    for (project_id, event) in terminal_events {
        let _ = publish_terminal_event(&mut session, project_id, event);
    }
    let task_activities = session
        .task_activity
        .fail_active()
        .then(|| session.task_activity.snapshot());
    let event = session.transition(RuntimeStatus::Failed, Some(ProviderKind::Codex));
    let _ = session.publish(event);
    let restart = app.map(|_| prepare_runtime_restart(&mut session));
    drop(session);
    if let (Some(app), Some(task_activities)) = (app, task_activities.as_deref()) {
        if let Err(error) = render_tray_task_activities(app, task_activities) {
            eprintln!("failed to update tray after runtime failure: {error}");
        }
        if let Err(error) = render_desktop_pet_task_activities(app, task_activities).await {
            eprintln!("failed to update desktop pet after runtime failure: {error}");
        }
    }
    if let (Some(app), Some((generation, delay))) = (app, restart) {
        schedule_runtime_restart(app.clone(), generation, delay);
    }
}

fn map_terminal_request(
    pending: PendingServerRequest,
    status: &str,
) -> Result<(String, Value), AppError> {
    let mut request = pending.request;
    request["status"] = json!(status);
    let project_id = required_event_string(&request, "projectId")?;
    let event = json!({
        "itemId": required_event_string(&request, "itemId")?,
        "payload": {"request": request},
        "provider": "codex",
        "sequence": 0,
        "sessionId": crate::infrastructure::codex::RUNTIME_SESSION_ID,
        "taskId": required_event_string(&request, "taskId")?,
        "timestamp": required_event_string(&request, "createdAt")?,
        "turnId": required_event_string(&request, "turnId")?,
        "type": "pending_request.expired",
        "version": 2,
    });
    Ok((project_id, event))
}

fn publish_terminal_event(
    runtime: &mut RuntimeSession,
    project_id: String,
    mut event: Value,
) -> Result<(), AppError> {
    let sequence = runtime.project_sequences.entry(project_id).or_default();
    *sequence += 1;
    event["sequence"] = Value::from(*sequence);
    runtime.publish(AppEvent::AgentEvent {
        event: event.into(),
    })
}

pub(super) fn required_event_string(value: &Value, key: &str) -> Result<String, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(AppError::CodexRequestFailed)
}
