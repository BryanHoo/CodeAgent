use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{
    ClockPort, CodeAgentError, CodeAgentErrorCode, PortRequestContext, ProjectProviderPort,
    ProviderPort, UpdatePort,
};
use code_agent_protocol::{AgentCapabilities, AgentModelPage, Project, ProjectId};
use code_agent_provider_codex::{
    CodexAppServerOptions, CodexAppServerProcess, CodexRuntimeProvider, LocateCodexBinaryOptions,
    locate_codex_binary, start_codex_app_server,
};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDiagnostic {
    pub message: Option<String>,
    pub state: &'static str,
}

/// Runtime 启动前即可注入的 Provider 容器；Codex 握手成功后原子切换到真实实现。
#[derive(Default)]
pub struct DesktopProvider {
    diagnostic: RwLock<ProviderDiagnostic>,
    provider: RwLock<Option<Arc<dyn ProviderPort>>>,
}

impl Default for ProviderDiagnostic {
    fn default() -> Self {
        Self {
            message: None,
            state: "starting",
        }
    }
}

impl DesktopProvider {
    pub fn install(&self, provider: Arc<dyn ProviderPort>) {
        if let Ok(mut slot) = self.provider.write() {
            *slot = Some(provider);
        }
        if let Ok(mut diagnostic) = self.diagnostic.write() {
            *diagnostic = ProviderDiagnostic {
                message: None,
                state: "ready",
            };
        }
    }

    pub fn fail(&self, message: impl Into<String>) {
        if let Ok(mut slot) = self.provider.write() {
            *slot = None;
        }
        if let Ok(mut diagnostic) = self.diagnostic.write() {
            *diagnostic = ProviderDiagnostic {
                message: Some(message.into()),
                state: "failed",
            };
        }
    }

    pub fn diagnostic(&self) -> ProviderDiagnostic {
        self.diagnostic
            .read()
            .map(|diagnostic| diagnostic.clone())
            .unwrap_or_else(|_| ProviderDiagnostic {
                message: Some("provider diagnostic lock is poisoned".to_owned()),
                state: "failed",
            })
    }

    fn current(&self) -> Result<Arc<dyn ProviderPort>, CodeAgentError> {
        self.provider
            .read()
            .ok()
            .and_then(|provider| provider.clone())
            .ok_or_else(|| {
                CodeAgentError::new(
                    CodeAgentErrorCode::ProviderFailure,
                    self.diagnostic()
                        .message
                        .unwrap_or_else(|| "Codex App Server is not ready".to_owned()),
                    None,
                )
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
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
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
        self.current()?.for_project(project, context).await
    }

    async fn release_project(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        match self.current() {
            Ok(provider) => provider.release_project(project_id, context).await,
            Err(_) => Ok(()),
        }
    }
}

pub struct DesktopHostPorts;

impl ClockPort for DesktopHostPorts {
    fn now(&self) -> DateTime<Utc> {
        std::time::SystemTime::now().into()
    }
}

#[async_trait]
impl UpdatePort for DesktopHostPorts {
    async fn current_version(
        &self,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        Ok(env!("CARGO_PKG_VERSION").to_owned())
    }
}

#[derive(Default)]
pub struct CodexSupervisor {
    process: Mutex<Option<Arc<CodexAppServerProcess>>>,
}

impl CodexSupervisor {
    pub async fn set(&self, process: Arc<CodexAppServerProcess>) {
        *self.process.lock().await = Some(process);
    }

    pub async fn close(&self) -> Result<(), CodeAgentError> {
        let process = self.process.lock().await.take();
        if let Some(process) = process {
            process.close().await
        } else {
            Ok(())
        }
    }
}

pub async fn start_codex_supervisor(
    provider_slot: Arc<DesktopProvider>,
    supervisor: Arc<CodexSupervisor>,
    app_version: String,
    executable_path: PathBuf,
) {
    let binary = match locate_desktop_codex(&executable_path) {
        Ok(binary) => binary,
        Err(error) => {
            provider_slot.fail(error.message());
            return;
        }
    };
    let process = match start_codex_app_server(CodexAppServerOptions {
        app_version,
        binary_path: binary,
        ..CodexAppServerOptions::default()
    })
    .await
    {
        Ok(process) => Arc::new(process),
        Err(error) => {
            provider_slot.fail(error.message());
            return;
        }
    };
    let Some(incoming) = process.take_incoming() else {
        provider_slot.fail("Codex incoming RPC stream is unavailable");
        let _ = process.close().await;
        return;
    };
    let provider: Arc<dyn ProviderPort> = Arc::new(CodexRuntimeProvider::new(
        process.client().clone(),
        incoming,
    ));
    provider_slot.install(provider);
    supervisor.set(process.clone()).await;

    let exit = process.wait_for_exit().await;
    let detail = process.stderr_tail();
    provider_slot.fail(format!(
        "Codex App Server exited with code {:?}, signal {:?}{}",
        exit.code,
        exit.signal,
        if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        }
    ));
}

fn locate_desktop_codex(executable_path: &Path) -> Result<PathBuf, CodeAgentError> {
    let triple = target_triple();
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let executable_dir = executable_path.parent().unwrap_or_else(|| Path::new("."));
    let candidates = vec![
        executable_dir.join(format!("codex-{triple}{suffix}")),
        executable_dir.join(format!("codex{suffix}")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("codex-{triple}{suffix}")),
    ];
    let environment_path = std::env::var_os("CODE_AGENT_CODEX_BIN").map(PathBuf::from);
    locate_codex_binary(&LocateCodexBinaryOptions {
        candidate_paths: candidates,
        environment_path,
        explicit_path: None,
    })
    .map(|binary| binary.path)
}

fn target_triple() -> &'static str {
    option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or(
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "aarch64-apple-darwin"
        } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
            "x86_64-apple-darwin"
        } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
            "aarch64-pc-windows-msvc"
        } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
            "x86_64-pc-windows-msvc"
        } else if cfg!(target_arch = "aarch64") {
            "aarch64-unknown-linux-musl"
        } else {
            "x86_64-unknown-linux-musl"
        },
    )
}
