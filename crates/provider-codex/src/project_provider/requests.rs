use std::sync::Arc;

use serde_json::json;

use super::CodexProjectProvider;
use crate::{RpcServerRequest, map_codex_server_request};

impl CodexProjectProvider {
    pub(crate) async fn receive_server_request(self: &Arc<Self>, request: RpcServerRequest) {
        let now = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now());
        match map_codex_server_request(&request, self.project.id.as_str(), now) {
            Ok(Some(pending)) => {
                if !self
                    .pending
                    .activate(pending.clone())
                    .is_ok_and(|inserted| inserted)
                {
                    let _ = self
                        .client
                        .reject_server_request(
                            request.id,
                            -32000,
                            "Pending request capacity exceeded",
                        )
                        .await;
                    return;
                }
                if let Ok(event) = code_agent_protocol::parse_provider_event(json!({
                    "itemId": pending.request["itemId"], "payload": { "request": pending.request },
                    "taskId": pending.request["taskId"], "turnId": pending.request["turnId"], "type": "pending_request.created"
                })) {
                    self.publish(event).await;
                }
                self.schedule_expiry(pending);
            }
            _ => {
                let _ = self
                    .client
                    .reject_server_request(request.id, -32602, "Invalid provider request")
                    .await;
            }
        }
    }

    fn schedule_expiry(self: &Arc<Self>, pending: crate::PendingCodexRequest) {
        let Some(expires_at) = pending.request["expiresAt"].as_str() else {
            return;
        };
        let Ok(expires_at) = chrono::DateTime::parse_from_rfc3339(expires_at) else {
            return;
        };
        let now = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now());
        let delay = (expires_at.with_timezone(&chrono::Utc) - now)
            .to_std()
            .unwrap_or_default();
        let request_id = pending.request["requestId"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let provider_request_id = pending.provider_request_id;
        let provider = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let Some(provider) = provider.upgrade() else {
                return;
            };
            let Some(events) = provider.pending.expire_request(&request_id) else {
                return;
            };
            let _ = provider
                .client
                .respond_to_server_request(provider_request_id, json!({ "answers": {} }))
                .await;
            for event in events {
                provider.publish_value(event);
            }
        });
    }

    pub(crate) fn receive_resolved_request(&self, request_id: &str, task_id: &str) {
        for event in self.pending.resolve_native(request_id, task_id) {
            self.publish_value(event);
        }
    }
}
