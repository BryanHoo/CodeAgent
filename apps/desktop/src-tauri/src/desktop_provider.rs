use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use code_agent_core::{
    CodeAgentError, CodeAgentErrorCode, PortRequestContext, ProjectProviderPort, ProviderPort,
};
use code_agent_protocol::{AgentCapabilities, AgentModelPage, Project, ProjectId};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::Mutex as AsyncMutex;

use crate::desktop_project_provider::DesktopProjectProvider;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadiness {
    pub state: &'static str,
}

#[derive(Clone, Debug)]
struct ProviderDiagnostic {
    message: Option<String>,
    state: &'static str,
}

impl Default for ProviderDiagnostic {
    fn default() -> Self {
        Self {
            message: None,
            state: "starting",
        }
    }
}

/// Runtime 启动前即可注入的 Provider 容器，并在进程恢复时原子迁移 Project。
#[derive(Default)]
pub struct DesktopProvider {
    diagnostic: RwLock<ProviderDiagnostic>,
    projects: RwLock<HashMap<String, Arc<DesktopProjectProvider>>>,
    provider: RwLock<Option<Arc<dyn ProviderPort>>>,
    transition: AsyncMutex<()>,
}

impl DesktopProvider {
    pub async fn install(&self, provider: Arc<dyn ProviderPort>) -> Result<(), CodeAgentError> {
        let _transition = self.transition.lock().await;
        let projects = self
            .projects
            .read()
            .map_err(|_| CodeAgentError::internal("project provider registry is poisoned"))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for project in projects {
            let backend = provider
                .for_project(
                    project.project().clone(),
                    &PortRequestContext::new(format!(
                        "restore-project-{}",
                        project.project().id.as_str()
                    )),
                )
                .await?;
            project.install(backend).await?;
        }
        *self
            .provider
            .write()
            .map_err(|_| CodeAgentError::internal("provider lock is poisoned"))? = Some(provider);
        *self
            .diagnostic
            .write()
            .map_err(|_| CodeAgentError::internal("provider diagnostic lock is poisoned"))? =
            ProviderDiagnostic {
                message: None,
                state: "ready",
            };
        Ok(())
    }

    pub fn fail(&self, message: impl Into<String>) {
        if let Ok(mut provider) = self.provider.write() {
            *provider = None;
        }
        if let Ok(projects) = self.projects.read() {
            for project in projects.values() {
                project.disconnect();
            }
        }
        if let Ok(mut diagnostic) = self.diagnostic.write() {
            *diagnostic = ProviderDiagnostic {
                message: Some(message.into()),
                state: "failed",
            };
        }
    }

    pub fn readiness(&self) -> RuntimeReadiness {
        self.diagnostic
            .read()
            .map(|diagnostic| RuntimeReadiness {
                state: diagnostic.state,
            })
            .unwrap_or(RuntimeReadiness { state: "failed" })
    }

    fn current(&self) -> Result<Arc<dyn ProviderPort>, CodeAgentError> {
        self.provider
            .read()
            .ok()
            .and_then(|provider| provider.clone())
            .ok_or_else(|| {
                let message = self
                    .diagnostic
                    .read()
                    .ok()
                    .and_then(|diagnostic| diagnostic.message.clone())
                    .unwrap_or_else(|| "Codex App Server is not ready".to_owned());
                CodeAgentError::new(CodeAgentErrorCode::ProviderFailure, message, None)
            })
    }
}

#[async_trait]
impl ProviderPort for DesktopProvider {
    async fn capabilities(
        &self,
        context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        if let Ok(provider) = self.current() {
            return provider.capabilities(context).await;
        }
        serde_json::from_value(json!({
            "feedback": { "upload": false }, "provider": "unavailable",
            "skills": { "list": false, "use": false },
            "tasks": { "fork": false, "list": false, "read": false, "start": false },
            "turns": { "compact": false, "interrupt": false, "review": false, "start": false, "steer": false }
        })).map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn models(&self, context: &PortRequestContext) -> Result<AgentModelPage, CodeAgentError> {
        self.current()?.models(context).await
    }

    async fn default_settings(
        &self,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?.default_settings(context).await
    }

    async fn connection_status(
        &self,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?.connection_status(context).await
    }

    async fn start_official_login(
        &self,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?.start_official_login(context).await
    }

    async fn cancel_login(
        &self,
        login_id: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?.cancel_login(login_id, context).await
    }

    async fn logout(&self, context: &PortRequestContext) -> Result<Value, CodeAgentError> {
        self.current()?.logout(context).await
    }

    async fn configure_custom(
        &self,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?.configure_custom(input, context).await
    }

    async fn for_project(
        &self,
        project: Project,
        context: &PortRequestContext,
    ) -> Result<Arc<dyn ProjectProviderPort>, CodeAgentError> {
        let _transition = self.transition.lock().await;
        let project_id = project.id.to_string();
        if let Some(existing) = self
            .projects
            .read()
            .ok()
            .and_then(|projects| projects.get(&project_id).cloned())
        {
            if existing.project().root_path != project.root_path {
                return Err(CodeAgentError::internal(
                    "Desktop project identity belongs to another root",
                ));
            }
            return Ok(existing);
        }
        let backend = self
            .current()?
            .for_project(project.clone(), context)
            .await?;
        let proxy = Arc::new(DesktopProjectProvider::new(project));
        proxy.install(backend).await?;
        self.projects
            .write()
            .map_err(|_| CodeAgentError::internal("project provider registry is poisoned"))?
            .insert(project_id, proxy.clone());
        Ok(proxy)
    }

    async fn release_project(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        let _transition = self.transition.lock().await;
        if let Some(project) = self
            .projects
            .write()
            .map_err(|_| CodeAgentError::internal("project provider registry is poisoned"))?
            .remove(project_id.as_str())
        {
            project.disconnect();
        }
        match self.current() {
            Ok(provider) => provider.release_project(project_id, context).await,
            Err(_) => Ok(()),
        }
    }
}
