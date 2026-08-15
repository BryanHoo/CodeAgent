use std::{path::PathBuf, sync::Arc, time::Duration};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{
    AttachmentPort, ClockPort, CodeAgentError, FilePort, GitPort, PortRequestContext, ProviderPort,
    RepositoryPort, UpdatePort,
};
use code_agent_platform::{
    AttachmentStore, DatabaseOptions, GitCliService, PlatformDatabase, PlatformFilePort,
    ProcessEnvironment, SqliteRepository,
};
use code_agent_provider_codex::{
    CodexAppServerOptions, CodexAppServerProcess, CodexRuntimeProvider, start_codex_app_server,
};
use code_agent_runtime::{CodeAgentRuntime, CodeAgentRuntimeBuilder, RuntimeOptions};

use crate::{errors::invalid_input, types::NodeEngineOptions};

struct NodeHostPorts {
    version: String,
}

impl ClockPort for NodeHostPorts {
    fn now(&self) -> DateTime<Utc> {
        std::time::SystemTime::now().into()
    }
}

#[async_trait]
impl UpdatePort for NodeHostPorts {
    async fn current_version(
        &self,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        Ok(self.version.clone())
    }
}

pub struct NodeRuntimeHost {
    pub database: PlatformDatabase,
    pub process: Arc<CodexAppServerProcess>,
    pub runtime: Arc<CodeAgentRuntime>,
}

fn absolute_path(value: &str, name: &str) -> napi::Result<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(invalid_input(format!("{name} must be absolute")));
    }
    Ok(path)
}

pub async fn open_runtime(options: NodeEngineOptions) -> napi::Result<NodeRuntimeHost> {
    let database_path = absolute_path(&options.database_path, "databasePath")?;
    let temporary_workspace = absolute_path(&options.temporary_workspace, "temporaryWorkspace")?;
    let attachment_root = absolute_path(&options.attachment_root, "attachmentRoot")?;
    let codex_home = absolute_path(&options.codex_home, "codexHome")?;
    let codex_path = absolute_path(&options.codex_path, "codexPath")?;
    tokio::fs::create_dir_all(&temporary_workspace).await?;

    let database = PlatformDatabase::open(DatabaseOptions {
        path: database_path,
        queue_capacity: 64,
        request_timeout: Duration::from_secs(5),
    })
    .await
    .map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let repository: Arc<dyn RepositoryPort> = Arc::new(SqliteRepository::new(database.clone()));
    let process_environment =
        ProcessEnvironment::capture_with_path(std::env::var_os("PATH").unwrap_or_default());
    let file: Arc<dyn FilePort> = Arc::new(PlatformFilePort::new(
        database.clone(),
        process_environment.clone(),
    ));
    let git: Arc<dyn GitPort> = Arc::new(GitCliService::new(database.clone(), process_environment));
    let attachment: Arc<dyn AttachmentPort> = Arc::new(
        AttachmentStore::new(attachment_root)
            .map_err(|error| napi::Error::from_reason(error.to_string()))?,
    );
    let process = Arc::new(
        start_codex_app_server(CodexAppServerOptions {
            app_version: options.app_version.clone(),
            binary_path: codex_path,
            env_overrides: vec![(
                "CODEX_HOME".to_string(),
                codex_home.to_string_lossy().into_owned(),
            )],
            ..CodexAppServerOptions::default()
        })
        .await
        .map_err(crate::errors::to_napi_error)?,
    );
    let incoming = process
        .take_incoming()
        .ok_or_else(|| napi::Error::from_reason("Codex incoming RPC stream is unavailable"))?;
    let provider: Arc<dyn ProviderPort> = Arc::new(CodexRuntimeProvider::new_with_codex_home(
        process.client().clone(),
        incoming,
        codex_home,
    ));
    let host = Arc::new(NodeHostPorts {
        version: options.app_version,
    });
    let clock: Arc<dyn ClockPort> = host.clone();
    let update: Arc<dyn UpdatePort> = host;
    let runtime = Arc::new(
        CodeAgentRuntimeBuilder::new(RuntimeOptions {
            idempotency_capacity: 1_024,
            idempotency_ttl: Duration::from_secs(30 * 60),
            operation_capacity: 256,
            shutdown_timeout: Duration::from_secs(10),
            temporary_project_root: Some(temporary_workspace),
        })
        .repository(repository)
        .provider(provider)
        .git(git)
        .file(file)
        .attachment(attachment)
        .clock(clock)
        .update(update)
        .build(),
    );
    Ok(NodeRuntimeHost {
        database,
        process,
        runtime,
    })
}
