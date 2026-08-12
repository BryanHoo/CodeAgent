use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

use async_trait::async_trait;
use code_agent_core::{CodeAgentError, PortRequestContext, ProjectProviderPort, ProviderPort};
use code_agent_protocol::{AgentCapabilities, AgentModelPage, Project, ProjectId};
use serde_json::{Value, json};
use tokio::task::JoinHandle;

use crate::{
    JsonlRpcClient, RpcIncoming, RpcServerRequest, map_codex_notification,
    rpc_error_to_code_agent_error,
};

use crate::connection::{discover_models, map_model};
use crate::project_provider::CodexProjectProvider;

fn bounded_string(value: Option<&Value>, maximum_chars: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(|value| value.chars().take(maximum_chars).collect())
}

fn map_connection_account(value: &Value) -> Value {
    match value.get("type").and_then(Value::as_str) {
        Some("apiKey") => json!({ "type": "apiKey" }),
        Some("chatgpt") => json!({
            "email": bounded_string(value.get("email"), 320),
            "planType": bounded_string(value.get("planType"), 64),
            "type": "chatgpt"
        }),
        _ => Value::Null,
    }
}

fn map_connection_status(config_response: &Value, account_response: &Value) -> Value {
    let config = config_response.get("config").and_then(Value::as_object);
    let provider_id = config
        .and_then(|config| config.get("model_provider"))
        .and_then(Value::as_str)
        .unwrap_or("openai");
    let openai_base_url = config
        .and_then(|config| bounded_string(config.get("openai_base_url"), 2_048))
        .filter(|value| !value.is_empty());
    let (mode, custom_base_url) = if provider_id == "openai" && openai_base_url.is_none() {
        ("official", None)
    } else if provider_id == "openai" {
        ("custom", openai_base_url)
    } else {
        let base_url = config
            .and_then(|config| config.get("model_providers"))
            .and_then(Value::as_object)
            .and_then(|providers| providers.get(provider_id))
            .and_then(Value::as_object)
            .and_then(|provider| bounded_string(provider.get("base_url"), 2_048))
            .filter(|value| !value.is_empty());
        ("custom", base_url)
    };
    let account = map_connection_account(&account_response["account"]);
    let requires_openai_auth = account_response["requiresOpenaiAuth"]
        .as_bool()
        .unwrap_or(true);
    // 自定义 Provider 可以声明无需 OpenAI 认证，此时没有账户也属于已连接。
    let connected = if mode == "custom" {
        !requires_openai_auth || !account.is_null()
    } else {
        !account.is_null()
    };
    json!({
        "account": account,
        "customBaseUrl": custom_base_url,
        "mode": mode,
        "pendingLogin": null,
        "state": if connected { "connected" } else { "disconnected" }
    })
}

struct ProviderInner {
    client: JsonlRpcClient,
    incoming_task: Mutex<Option<JoinHandle<()>>>,
    owners: Arc<Mutex<HashMap<String, String>>>,
    projects: Mutex<HashMap<String, Arc<CodexProjectProvider>>>,
    review_workers: Mutex<HashMap<String, String>>,
}

/// 全局 Codex Runtime Provider，独占 RPC 入站流并按 Task owner 路由。
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
            projects: Mutex::new(HashMap::new()),
            review_workers: Mutex::new(HashMap::new()),
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
                        && inner.owners.lock().is_ok_and(|owners| owners.contains_key(parent_id))
                        && let Ok(mut workers) = inner.review_workers.lock()
                    {
                        workers.insert(worker_id.to_string(), parent_id.to_string());
                    }
                    continue;
                }
                let native_task_id = notification.params.get("threadId").and_then(Value::as_str).map(str::to_string);
                let parent_task_id = native_task_id.as_deref().and_then(|task_id| {
                    inner.review_workers.lock().ok().and_then(|workers| workers.get(task_id).cloned())
                });
                let task_id = parent_task_id.as_deref().or(native_task_id.as_deref());
                let Some(task_id) = task_id else { continue };
                let runtime = CodexRuntimeProvider { inner };
                let Some(provider) = runtime.project_for_task(task_id) else { continue };
                let mut params = notification.params;
                if parent_task_id.is_some() {
                    params["threadId"] = Value::String(task_id.to_string());
                }
                if let Ok(Some(event)) = map_codex_notification(&notification.method, &params) {
                    provider.publish(event).await;
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
        let response = self
            .rpc(
                "model/list",
                Some(json!({ "includeHidden": false, "limit": 100 })),
            )
            .await?;
        let data = response
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
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
        let (config, account) = tokio::try_join!(
            self.rpc("config/read", Some(json!({ "includeLayers": false }))),
            self.rpc("account/read", Some(json!({ "refreshToken": false })))
        )?;
        Ok(map_connection_status(&config, &account))
    }

    async fn start_official_login(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.rpc("config/batchWrite", Some(json!({ "edits": [{ "keyPath": "model_provider", "mergeStrategy": "upsert", "value": "openai" }] }))).await?;
        self.rpc("account/login/start", Some(json!({ "appBrand": "chatgpt", "type": "chatgpt", "useHostedLoginSuccessPage": true }))).await
    }

    async fn cancel_login(
        &self,
        login_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.rpc("account/login/cancel", Some(json!({ "loginId": login_id })))
            .await
    }

    async fn logout(&self, _context: &PortRequestContext) -> Result<Value, CodeAgentError> {
        self.rpc("account/logout", None).await
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
        Ok(json!({ "models": { "data": models, "nextCursor": null } }))
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
        let owned_tasks = self
            .inner
            .owners
            .lock()
            .map(|owners| {
                owners
                    .keys()
                    .cloned()
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        if let Ok(mut workers) = self.inner.review_workers.lock() {
            workers.retain(|_, parent| owned_tasks.contains(parent));
        }
        Ok(())
    }
}
