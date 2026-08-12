use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

use async_trait::async_trait;
use code_agent_core::{CodeAgentError, PortRequestContext, ProjectProviderPort, ProviderPort};
use code_agent_protocol::{AgentCapabilities, AgentModelPage, Project, ProjectId};
use serde_json::{Value, json};
use tokio::task::JoinHandle;

use crate::{
    JsonlRpcClient, RpcIncoming, RpcServerRequest, map_codex_notification, mapping::request_id_key,
    rpc_error_to_code_agent_error,
};

use crate::connection::{bounded_string, discover_models, map_connection_status, map_model};
use crate::goal::GoalRegistry;
use crate::pagination::PaginationGuard;
use crate::project_provider::CodexProjectProvider;
use crate::review::ReviewRegistry;
struct ProviderInner {
    client: JsonlRpcClient,
    incoming_task: Mutex<Option<JoinHandle<()>>>,
    owners: Arc<Mutex<HashMap<String, String>>>,
    pending_login: Mutex<Option<Value>>,
    projects: Mutex<HashMap<String, Arc<CodexProjectProvider>>>,
    goals: Arc<GoalRegistry>,
    reviews: Arc<ReviewRegistry>,
}

#[derive(Clone)]
pub struct CodexRuntimeProvider {
    inner: Arc<ProviderInner>,
}

impl CodexRuntimeProvider {
    #[must_use]
    pub fn new(client: JsonlRpcClient, incoming: RpcIncoming) -> Self {
        let inner = Arc::new(ProviderInner {
            client,
            incoming_task: Mutex::new(None),
            owners: Arc::new(Mutex::new(HashMap::new())),
            pending_login: Mutex::new(None),
            projects: Mutex::new(HashMap::new()),
            goals: Arc::new(GoalRegistry::default()),
            reviews: Arc::new(ReviewRegistry::default()),
        });
        let task = tokio::spawn(route_incoming(Arc::downgrade(&inner), incoming));
        if let Ok(mut slot) = inner.incoming_task.lock() {
            *slot = Some(task);
        }
        Self { inner }
    }

    fn project_for_task(&self, task_id: &str) -> Option<Arc<CodexProjectProvider>> {
        let project_id = self
            .inner
            .owners
            .lock()
            .ok()
            .and_then(|owners| owners.get(task_id).cloned())?;
        self.inner
            .projects
            .lock()
            .ok()
            .and_then(|projects| projects.get(&project_id).cloned())
    }

    async fn rpc(&self, method: &str, params: Option<Value>) -> Result<Value, CodeAgentError> {
        self.inner
            .client
            .request(method, params)
            .await
            .map_err(|error| rpc_error_to_code_agent_error(&error))
    }

    async fn read_connection_status(&self) -> Result<Value, CodeAgentError> {
        let (config, account) = tokio::try_join!(
            self.rpc("config/read", Some(json!({ "includeLayers": false }))),
            self.rpc("account/read", Some(json!({ "refreshToken": false })))
        )?;
        let pending = self
            .inner
            .pending_login
            .lock()
            .ok()
            .and_then(|value| value.clone());
        Ok(map_connection_status(&config, &account, pending))
    }
}

async fn route_incoming(inner: Weak<ProviderInner>, mut incoming: RpcIncoming) {
    loop {
        tokio::select! {
            notification = incoming.notifications.recv() => {
                let Some(notification) = notification else { break };
                let Some(inner) = inner.upgrade() else { break };
                if notification.method == "thread/started" {
                    let thread = &notification.params["thread"];
                    if thread["source"]["subAgent"] == "review"
                        && let (Some(worker_id), Some(parent_id)) = (
                            thread["id"].as_str(),
                            thread["parentThreadId"].as_str(),
                        )
                        && let Some(project_id) = inner.owners.lock().ok().and_then(|owners| owners.get(parent_id).cloned())
                    {
                        inner.reviews.register_worker(parent_id, worker_id);
                        if let Ok(mut owners) = inner.owners.lock() {
                            owners.insert(worker_id.to_owned(), project_id);
                        }
                        if let Some(provider) = (CodexRuntimeProvider { inner: Arc::clone(&inner) }).project_for_task(parent_id) {
                            let worker_id = worker_id.to_owned();
                            tokio::spawn(async move {
                                let _ = provider.resume(&worker_id).await;
                            });
                        }
                    }
                    continue;
                }
                if notification.method == "account/updated" {
                    if notification.params["authMode"] == "chatgpt"
                        && let Ok(mut pending) = inner.pending_login.lock()
                    {
                        *pending = None;
                    }
                    continue;
                }
                if notification.method == "account/login/completed" {
                    let login_id = notification.params["loginId"].as_str();
                    if let (Some(login_id), Ok(mut pending)) = (login_id, inner.pending_login.lock())
                        && pending.as_ref().and_then(|value| value["loginId"].as_str()) == Some(login_id)
                    {
                        if notification.params["success"] == true {
                            *pending = None;
                        } else {
                            let error = bounded_string(notification.params.get("error"), 1_000)
                                .unwrap_or_else(|| "Login failed".to_owned());
                            *pending = Some(json!({ "error": error, "loginId": login_id, "state": "failed" }));
                        }
                    }
                    continue;
                }
                if notification.method == "mcpServer/startupStatus/updated" {
                    let task_id = notification.params["threadId"].as_str();
                    if let Some(provider) = task_id.and_then(|id| (CodexRuntimeProvider { inner: Arc::clone(&inner) }).project_for_task(id)) {
                        provider.receive_mcp_status(&notification.params).await;
                    }
                    continue;
                }
                if notification.method == "serverRequest/resolved" {
                    let task_id = notification.params["threadId"].as_str();
                    let request_id = request_id_key(&notification.params["requestId"]).ok();
                    if let (Some(task_id), Some(request_id)) = (task_id, request_id)
                        && let Some(provider) = (CodexRuntimeProvider { inner: Arc::clone(&inner) }).project_for_task(task_id)
                    {
                        provider.receive_resolved_request(&request_id, task_id);
                    }
                    continue;
                }
                let native_task_id = notification.params.get("threadId").and_then(Value::as_str).map(str::to_string);
                if notification.method == "turn/started"
                    && let (Some(task_id), Some(turn)) = (
                        native_task_id.as_deref(),
                        notification.params.get("turn").cloned(),
                    )
                {
                    inner.goals.started(task_id, turn);
                    if inner.reviews.contains(task_id)
                        && let Some(turn_id) = notification.params.pointer("/turn/id").and_then(Value::as_str)
                    {
                        inner.reviews.set_outer_turn(task_id, turn_id);
                    }
                }
                let route = native_task_id.as_deref().and_then(|task_id| {
                    let turn_id = notification.params.get("turnId").and_then(Value::as_str)
                        .or_else(|| notification.params.pointer("/turn/id").and_then(Value::as_str));
                    let item_type = notification.params.pointer("/item/type").and_then(Value::as_str);
                    let item_phase = notification.params.pointer("/item/phase").and_then(Value::as_str);
                    inner.reviews.route(task_id, turn_id, &notification.method, item_type, item_phase)
                });
                let parent_task_id = route.as_ref().map(|route| route.parent_task_id.as_str());
                let task_id = parent_task_id.or(native_task_id.as_deref());
                let Some(task_id) = task_id else { continue };
                let notification_item_type = notification
                    .params
                    .pointer("/item/type")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let runtime = CodexRuntimeProvider { inner: Arc::clone(&inner) };
                let Some(provider) = runtime.project_for_task(task_id) else { continue };
                let mut params = notification.params;
                if route.as_ref().is_some_and(|route| route.suppress) {
                    continue;
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
                    if matches!(notification.method.as_str(), "turn/started" | "turn/completed")
                        && route.is_some()
                        && let Some(turn_id) = event.turn_id().map(str::to_owned)
                        && let Some(item) = inner.reviews.target_item(task_id, &turn_id)
                    {
                        let mut value = event.as_value().clone();
                        value["payload"]["turn"]["items"] = json!([item]);
                        if let Ok(mapped) = code_agent_protocol::parse_provider_event(value) {
                            event = mapped;
                        }
                    }
                    if matches!(notification.method.as_str(), "item/started" | "item/completed")
                        && notification_item_type.as_deref() == Some("enteredReviewMode")
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
            request = incoming.server_requests.recv() => {
                let Some(request) = request else { break };
                let Some(inner) = inner.upgrade() else { break };
                let runtime = CodexRuntimeProvider { inner };
                route_server_request(&runtime, request).await;
            }
            error = incoming.errors.recv() => {
                let Some(_error) = error else { break };
                let Some(inner) = inner.upgrade() else { break };
                let providers = inner.projects.lock().map(|projects| projects.values().cloned().collect::<Vec<_>>()).unwrap_or_default();
                for provider in providers {
                    provider.publish_failure().await;
                }
            }
        }
    }
}

async fn route_server_request(runtime: &CodexRuntimeProvider, request: RpcServerRequest) {
    let task_id = request.params.get("threadId").and_then(Value::as_str);
    let Some(provider) = task_id.and_then(|task_id| runtime.project_for_task(task_id)) else {
        let _ = runtime
            .inner
            .client
            .reject_server_request(request.id, -32602, "Task project is unknown")
            .await;
        return;
    };
    provider.receive_server_request(request).await;
}

#[async_trait]
impl ProviderPort for CodexRuntimeProvider {
    async fn capabilities(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        serde_json::from_value(json!({
            "feedback": { "upload": true },
            "provider": "codex",
            "skills": { "list": true, "use": true },
            "tasks": { "fork": true, "list": true, "read": true, "start": true },
            "turns": { "compact": true, "interrupt": true, "review": true, "start": true, "steer": true }
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn models(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentModelPage, CodeAgentError> {
        let mut data = Vec::new();
        let mut cursor = None::<String>;
        let mut pagination = PaginationGuard::new("model/list", 1_000);
        loop {
            let mut params = json!({ "includeHidden": false, "limit": 100 });
            if let Some(value) = &cursor {
                params["cursor"] = Value::String(value.clone());
            }
            let response = self.rpc("model/list", Some(params)).await?;
            data.extend(
                response["data"]
                    .as_array()
                    .cloned()
                    .ok_or_else(|| CodeAgentError::internal("model/list data must be an array"))?,
            );
            cursor = pagination.advance(&response, data.len())?;
            if cursor.is_none() {
                break;
            }
        }
        let mapped = data.into_iter().filter(|model| model.get("hidden") == Some(&Value::Bool(false))).map(|model| json!({
            "defaultReasoningEffort": model["defaultReasoningEffort"],
            "description": model["description"],
            "displayName": model["displayName"],
            "id": model["model"],
            "isDefault": model["isDefault"],
            "supportedReasoningEfforts": model["supportedReasoningEfforts"].as_array().map(|items| items.iter().map(|item| json!({ "description": item["description"], "id": item["reasoningEffort"] })).collect::<Vec<_>>()).unwrap_or_default()
        })).collect::<Vec<_>>();
        serde_json::from_value(json!({ "data": mapped, "nextCursor": null }))
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn default_settings(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.rpc("config/read", Some(json!({ "includeLayers": false })))
            .await
    }

    async fn connection_status(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.read_connection_status().await
    }

    async fn start_official_login(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.rpc("config/batchWrite", Some(json!({ "edits": [{ "keyPath": "model_provider", "mergeStrategy": "upsert", "value": "openai" }] }))).await?;
        let response = self.rpc("account/login/start", Some(json!({ "appBrand": "chatgpt", "type": "chatgpt", "useHostedLoginSuccessPage": true }))).await?;
        let login_id = response["loginId"]
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| CodeAgentError::internal("Codex returned an invalid login response"))?;
        let auth_url = response["authUrl"]
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| CodeAgentError::internal("Codex returned an invalid login response"))?;
        if response["type"] != "chatgpt" {
            return Err(CodeAgentError::internal(
                "Codex returned an invalid login response",
            ));
        }
        *self
            .inner
            .pending_login
            .lock()
            .map_err(|_| CodeAgentError::internal("login state is poisoned"))? =
            Some(json!({ "error": null, "loginId": login_id, "state": "pending" }));
        Ok(
            json!({ "authUrl": auth_url, "loginId": login_id, "status": self.read_connection_status().await? }),
        )
    }

    async fn cancel_login(
        &self,
        login_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.rpc("account/login/cancel", Some(json!({ "loginId": login_id })))
            .await?;
        if let Ok(mut pending) = self.inner.pending_login.lock()
            && pending.as_ref().and_then(|value| value["loginId"].as_str()) == Some(login_id)
        {
            *pending = None;
        }
        Ok(json!({ "status": self.read_connection_status().await? }))
    }

    async fn logout(&self, _context: &PortRequestContext) -> Result<Value, CodeAgentError> {
        self.rpc("account/logout", None).await?;
        if let Ok(mut pending) = self.inner.pending_login.lock() {
            *pending = None;
        }
        Ok(json!({ "status": self.read_connection_status().await? }))
    }

    async fn configure_custom(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let base_url = input
            .get("baseUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| CodeAgentError::internal("custom provider baseUrl is invalid"))?;
        let api_key = input.get("apiKey").and_then(Value::as_str);
        if let Some(api_key) = api_key {
            if api_key.trim().is_empty() {
                return Err(CodeAgentError::internal("custom provider apiKey is blank"));
            }
            self.rpc(
                "account/login/start",
                Some(json!({ "apiKey": api_key, "type": "apiKey" })),
            )
            .await?;
        }
        let manual_models = input
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let (base_url, mut models) = match discover_models(base_url, api_key).await {
            Ok(result) => result,
            Err(_error) if !manual_models.is_empty() => {
                (base_url.trim_end_matches('/').to_string(), Vec::new())
            }
            Err(error) => return Err(error),
        };
        for model in manual_models {
            if let Some(id) = model.get("id").and_then(Value::as_str) {
                models.retain(|existing| existing["id"] != id);
                let mut mapped = map_model(id);
                if let Some(name) = model.get("name").and_then(Value::as_str) {
                    mapped["displayName"] = Value::String(name.to_string());
                }
                models.push(mapped);
            }
        }
        self.rpc("config/batchWrite", Some(json!({ "edits": [
            { "keyPath": "model_providers.code_agent_custom", "mergeStrategy": "upsert", "value": { "base_url": base_url, "name": "CodeAgent Custom API", "requires_openai_auth": input.get("apiKey").is_some(), "wire_api": "responses" } },
            { "keyPath": "model_provider", "mergeStrategy": "upsert", "value": "code_agent_custom" }
        ] }))).await?;
        if let Ok(mut pending) = self.inner.pending_login.lock() {
            *pending = None;
        }
        Ok(json!({
            "models": { "data": models, "nextCursor": null },
            "status": self.read_connection_status().await?
        }))
    }

    async fn for_project(
        &self,
        project: Project,
        _context: &PortRequestContext,
    ) -> Result<Arc<dyn ProjectProviderPort>, CodeAgentError> {
        let project_id = project.id.to_string();
        if let Some(current) = self
            .inner
            .projects
            .lock()
            .ok()
            .and_then(|projects| projects.get(&project_id).cloned())
        {
            if current.root_path() != project.root_path.as_str() {
                return Err(CodeAgentError::internal(
                    "Codex project identity belongs to another cwd",
                ));
            }
            return Ok(current);
        }
        let provider = Arc::new(CodexProjectProvider::new(
            self.inner.client.clone(),
            project,
            Arc::clone(&self.inner.owners),
            Arc::clone(&self.inner.goals),
            Arc::clone(&self.inner.reviews),
        ));
        self.inner
            .projects
            .lock()
            .map_err(|_| CodeAgentError::internal("provider registry is poisoned"))?
            .insert(project_id, Arc::clone(&provider));
        Ok(provider)
    }

    async fn release_project(
        &self,
        project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        let project_id = project_id.to_string();
        self.inner
            .projects
            .lock()
            .map_err(|_| CodeAgentError::internal("provider registry is poisoned"))?
            .remove(&project_id);
        self.inner
            .owners
            .lock()
            .map_err(|_| CodeAgentError::internal("provider owner registry is poisoned"))?
            .retain(|_, owner| owner != &project_id);
        Ok(())
    }
}
