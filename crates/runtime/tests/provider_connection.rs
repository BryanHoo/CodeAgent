use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{
    AttachmentPort, ClockPort, CodeAgentError, FilePort, GitPort, PortRequestContext, ProviderPort,
    RepositoryPort, UpdatePort,
};
use code_agent_protocol::{
    AgentAttachment, AgentCapabilities, AgentModelPage, AgentProviderConnectionRecord, ProjectId,
    TaskId,
};
use code_agent_runtime::{CodeAgentRuntime, CodeAgentRuntimeBuilder, RuntimeOptions};
use serde_json::{Value, json};

struct FakePorts {
    provider_model_reads: AtomicUsize,
    stored_connection: Mutex<Option<AgentProviderConnectionRecord>>,
}

impl FakePorts {
    fn new(stored_connection: Option<AgentProviderConnectionRecord>) -> Self {
        Self {
            provider_model_reads: AtomicUsize::new(0),
            stored_connection: Mutex::new(stored_connection),
        }
    }
}

#[async_trait]
impl RepositoryPort for FakePorts {
    async fn read_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        Ok(None)
    }

    async fn read_provider_connection(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentProviderConnectionRecord>, CodeAgentError> {
        Ok(self
            .stored_connection
            .lock()
            .expect("provider connection lock")
            .clone())
    }

    async fn write_provider_connection(
        &self,
        record: &AgentProviderConnectionRecord,
        _context: &PortRequestContext,
    ) -> Result<AgentProviderConnectionRecord, CodeAgentError> {
        *self
            .stored_connection
            .lock()
            .expect("provider connection lock") = Some(record.clone());
        Ok(record.clone())
    }
}

#[async_trait]
impl ProviderPort for FakePorts {
    async fn capabilities(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        Err(CodeAgentError::internal("unused provider capability"))
    }

    async fn models(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentModelPage, CodeAgentError> {
        self.provider_model_reads.fetch_add(1, Ordering::SeqCst);
        Err(CodeAgentError::internal("custom /models is unavailable"))
    }

    async fn connection_status(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(custom_status())
    }

    async fn start_official_login(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({
            "authUrl": "https://auth.openai.com/authorize",
            "loginId": "login-1",
            "status": {
                "account": null,
                "customBaseUrl": null,
                "mode": "official",
                "pendingLogin": { "error": null, "loginId": "login-1", "state": "pending" },
                "state": "pending"
            }
        }))
    }

    async fn configure_custom(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({ "models": custom_models(), "status": custom_status() }))
    }
}

#[async_trait]
impl GitPort for FakePorts {
    async fn status(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Err(CodeAgentError::internal("unused git operation"))
    }
}

#[async_trait]
impl FilePort for FakePorts {
    async fn read(
        &self,
        _project_id: &ProjectId,
        _path: &str,
        _context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        Err(CodeAgentError::internal("unused file operation"))
    }
}

#[async_trait]
impl AttachmentPort for FakePorts {
    async fn read(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        Err(CodeAgentError::internal("unused attachment operation"))
    }

    async fn upload(
        &self,
        _project_id: &ProjectId,
        _kind: code_agent_protocol::AgentAttachmentKind,
        _media_type: &str,
        _name: &str,
        _bytes: Vec<u8>,
        _context: &PortRequestContext,
    ) -> Result<AgentAttachment, CodeAgentError> {
        Err(CodeAgentError::internal("unused attachment operation"))
    }
}

impl ClockPort for FakePorts {
    fn now(&self) -> DateTime<Utc> {
        DateTime::UNIX_EPOCH
    }
}

#[async_trait]
impl UpdatePort for FakePorts {
    async fn current_version(
        &self,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        Ok("1.9.0".to_owned())
    }
}

fn runtime(
    stored_connection: Option<AgentProviderConnectionRecord>,
) -> (Arc<FakePorts>, CodeAgentRuntime) {
    let ports = Arc::new(FakePorts::new(stored_connection));
    let runtime = CodeAgentRuntimeBuilder::new(RuntimeOptions {
        idempotency_capacity: 8,
        idempotency_ttl: Duration::from_secs(60),
        operation_capacity: 8,
        shutdown_timeout: Duration::from_secs(1),
        temporary_project_root: None,
    })
    .repository(ports.clone())
    .provider(ports.clone())
    .git(ports.clone())
    .file(ports.clone())
    .attachment(ports.clone())
    .clock(ports.clone())
    .update(ports.clone())
    .build();
    (ports, runtime)
}

fn custom_models() -> Value {
    json!({
        "data": [{
            "defaultReasoningEffort": "medium",
            "description": "",
            "displayName": "custom-model",
            "id": "custom-model",
            "isDefault": false,
            "supportedReasoningEfforts": [{ "description": "", "id": "medium" }]
        }],
        "nextCursor": null
    })
}

fn custom_status() -> Value {
    json!({
        "account": { "type": "apiKey" },
        "customBaseUrl": "https://api.example.com/v1",
        "mode": "custom",
        "pendingLogin": null,
        "state": "connected"
    })
}

fn custom_record() -> AgentProviderConnectionRecord {
    serde_json::from_value(json!({
        "customBaseUrl": "https://api.example.com/v1",
        "customModels": custom_models(),
        "mode": "custom",
        "updatedAt": "1970-01-01T00:00:00Z"
    }))
    .expect("custom provider record")
}

#[tokio::test]
async fn custom_configuration_and_official_login_should_persist_connection_records() {
    let (ports, runtime) = runtime(None);

    runtime
        .configure_custom_provider(
            "configure-custom",
            "configure-custom",
            json!({
                "apiKey": "must-not-be-persisted",
                "baseUrl": "https://api.example.com/v1"
            }),
        )
        .await
        .expect("configure custom provider");
    let custom = ports
        .stored_connection
        .lock()
        .expect("provider connection lock")
        .clone()
        .expect("stored custom connection");
    assert_eq!(
        serde_json::to_value(custom).expect("custom record"),
        json!({
            "customBaseUrl": "https://api.example.com/v1",
            "customModels": custom_models(),
            "mode": "custom",
            "updatedAt": "1970-01-01T00:00:00Z"
        })
    );

    runtime
        .start_provider_login("official-login", "official-login")
        .await
        .expect("start official login");
    let official = ports
        .stored_connection
        .lock()
        .expect("provider connection lock")
        .clone()
        .expect("stored official connection");
    assert_eq!(
        serde_json::to_value(official).expect("official record"),
        json!({
            "customBaseUrl": null,
            "customModels": null,
            "mode": "official",
            "updatedAt": "1970-01-01T00:00:00Z"
        })
    );
}

#[tokio::test]
async fn models_should_use_the_matching_persisted_custom_catalog() {
    let (ports, runtime) = runtime(Some(custom_record()));

    let models = runtime.models("models").await.expect("persisted models");

    assert_eq!(
        serde_json::to_value(models).expect("model page"),
        custom_models()
    );
    assert_eq!(ports.provider_model_reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn models_should_ignore_a_persisted_catalog_for_another_custom_url() {
    let mut stored = serde_json::to_value(custom_record()).expect("custom record");
    stored["customBaseUrl"] = Value::String("https://old.example.com/v1".to_owned());
    let (ports, runtime) = runtime(Some(
        serde_json::from_value(stored).expect("stale custom provider record"),
    ));

    runtime
        .models("models")
        .await
        .expect_err("provider fallback should expose its failure");

    assert_eq!(ports.provider_model_reads.load(Ordering::SeqCst), 1);
}
