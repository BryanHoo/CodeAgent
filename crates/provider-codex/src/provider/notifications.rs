use std::sync::Arc;

use serde_json::{Value, json};

use super::{CodexRuntimeProvider, ProviderInner};
use crate::{RpcNotification, map_codex_notification, mapping::request_id_key};

pub(super) async fn route_notification(inner: Arc<ProviderInner>, notification: RpcNotification) {
    if notification.method == "thread/started" {
        let thread = &notification.params["thread"];
        if thread["source"]["subAgent"] == "review"
            && let (Some(worker_id), Some(parent_id)) =
                (thread["id"].as_str(), thread["parentThreadId"].as_str())
            && let Some(project_id) = inner
                .owners
                .lock()
                .ok()
                .and_then(|owners| owners.get(parent_id).cloned())
        {
            inner.reviews.register_worker(parent_id, worker_id);
            if let Ok(mut owners) = inner.owners.lock() {
                owners.insert(worker_id.to_owned(), project_id);
            }
            if let Some(provider) = (CodexRuntimeProvider {
                inner: Arc::clone(&inner),
            })
            .project_for_task(parent_id)
            {
                let worker_id = worker_id.to_owned();
                tokio::spawn(async move {
                    let _ = provider.resume(&worker_id).await;
                });
            }
        }
        return;
    }
    if notification.method == "account/updated" {
        if notification.params["authMode"] == "chatgpt"
            && let Ok(mut pending) = inner.pending_login.lock()
        {
            *pending = None;
        }
        return;
    }
    if notification.method == "account/login/completed" {
        let login_id = notification.params["loginId"].as_str();
        if let (Some(login_id), Ok(mut pending)) = (login_id, inner.pending_login.lock())
            && pending.as_ref().and_then(|value| value["loginId"].as_str()) == Some(login_id)
        {
            if notification.params["success"] == true {
                *pending = None;
            } else {
                let error = notification.params["error"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| "Login failed".to_owned());
                *pending = Some(json!({ "error": error, "loginId": login_id, "state": "failed" }));
            }
        }
        return;
    }
    if notification.method == "mcpServer/startupStatus/updated" {
        let task_id = notification.params["threadId"].as_str();
        if let Some(provider) = task_id.and_then(|id| {
            (CodexRuntimeProvider {
                inner: Arc::clone(&inner),
            })
            .project_for_task(id)
        }) {
            provider.receive_mcp_status(&notification.params).await;
        }
        return;
    }
    if notification.method == "serverRequest/resolved" {
        let task_id = notification.params["threadId"].as_str();
        let request_id = request_id_key(&notification.params["requestId"]).ok();
        if let (Some(task_id), Some(request_id)) = (task_id, request_id)
            && let Some(provider) = (CodexRuntimeProvider {
                inner: Arc::clone(&inner),
            })
            .project_for_task(task_id)
        {
            provider.receive_resolved_request(&request_id, task_id);
        }
        return;
    }

    let native_task_id = notification.params["threadId"].as_str().map(str::to_string);
    if notification.method == "turn/started"
        && let (Some(task_id), Some(turn)) = (
            native_task_id.as_deref(),
            notification.params.get("turn").cloned(),
        )
    {
        inner.goals.started(task_id, turn);
        if inner.reviews.contains(task_id)
            && let Some(turn_id) = notification.params["turn"]["id"].as_str()
        {
            inner.reviews.set_outer_turn(task_id, turn_id);
        }
    }
    let route = native_task_id.as_deref().and_then(|task_id| {
        let turn_id = notification.params["turnId"]
            .as_str()
            .or_else(|| notification.params["turn"]["id"].as_str());
        let item_type = notification.params["item"]["type"].as_str();
        let item_phase = notification.params["item"]["phase"].as_str();
        inner.reviews.route(
            task_id,
            turn_id,
            &notification.method,
            item_type,
            item_phase,
        )
    });
    let task_id = route
        .as_ref()
        .map(|route| route.parent_task_id.as_str())
        .or(native_task_id.as_deref());
    let Some(task_id) = task_id else { return };
    let notification_item_type = notification.params["item"]["type"]
        .as_str()
        .map(str::to_owned);
    let Some(provider) = (CodexRuntimeProvider {
        inner: Arc::clone(&inner),
    })
    .project_for_task(task_id) else {
        return;
    };
    let mut params = notification.params;
    if route.as_ref().is_some_and(|route| route.suppress) {
        return;
    }
    if let Some(route) = &route {
        params["threadId"] = Value::String(task_id.to_string());
        if let Some(turn_id) = &route.outer_turn_id {
            params["turnId"] = Value::String(turn_id.clone());
            if notification.method.starts_with("turn/") {
                params["turn"]["id"] = Value::String(turn_id.clone());
            }
        }
    }
    if let Ok(Some(mut event)) = map_codex_notification(&notification.method, &params) {
        if matches!(
            notification.method.as_str(),
            "turn/started" | "turn/completed"
        ) && route.is_some()
            && let Some(turn_id) = event.turn_id().map(str::to_owned)
            && let Some(item) = inner.reviews.target_item(task_id, &turn_id)
        {
            let mut value = event.as_value().clone();
            value["payload"]["turn"]["items"] = json!([item]);
            if let Ok(mapped) = code_agent_protocol::parse_provider_event(value) {
                event = mapped;
            }
        }
        if matches!(
            notification.method.as_str(),
            "item/started" | "item/completed"
        ) && notification_item_type.as_deref() == Some("enteredReviewMode")
            && let Some(turn_id) = event.turn_id().map(str::to_owned)
            && let Some(item) = inner.reviews.target_item(task_id, &turn_id)
        {
            let mut value = event.as_value().clone();
            value["itemId"] = item["id"].clone();
            value["payload"]["item"] = item;
            if let Ok(mapped) = code_agent_protocol::parse_provider_event(value) {
                event = mapped;
            }
        }
        provider.publish(event).await;
    }
    if notification.method == "turn/completed"
        && route.as_ref().is_some_and(|route| !route.is_worker)
    {
        inner.reviews.clear(task_id);
    }
}
