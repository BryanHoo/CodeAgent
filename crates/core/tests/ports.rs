use std::sync::Arc;

use async_trait::async_trait;
use code_agent_core::{
    AgentMutationErrorCode, AttachmentPort, ClockPort, CodeAgentError, CodeAgentErrorCode,
    FilePort, GitPort, PortRequestContext, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_protocol::{AgentCapabilities, ProjectId, TaskId};
use serde_json::{Value, json};

struct FakePorts;

#[async_trait]
impl RepositoryPort for FakePorts {
    async fn read_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        Ok(Some(json!({ "id": "project-1" })))
    }
}

#[async_trait]
impl ProviderPort for FakePorts {
    async fn capabilities(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        serde_json::from_value(json!({
            "feedback": { "upload": false },
            "provider": "fake",
            "skills": { "list": true, "use": true },
            "tasks": { "fork": true, "list": true, "read": true, "start": true },
            "turns": {
                "compact": true,
                "interrupt": true,
                "review": true,
                "start": true,
                "steer": true
            }
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
}

#[async_trait]
impl GitPort for FakePorts {
    async fn status(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({ "branch": "main" }))
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
        Ok(b"hello".to_vec())
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
        Ok(vec![1, 2, 3])
    }
}

impl ClockPort for FakePorts {
    fn now(&self) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::UNIX_EPOCH
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

#[tokio::test]
async fn ports_should_share_request_context_and_cooperative_cancellation() {
    let context = PortRequestContext::new("request-1");
    let clone = context.clone();

    context.cancel();

    assert_eq!(clone.request_id(), "request-1");
    assert!(clone.is_cancelled());
}

#[test]
fn error_should_serialize_stable_protocol_shape() {
    let error = CodeAgentError::new(
        CodeAgentErrorCode::Conflict,
        "Git status changed",
        Some(Arc::<str>::from("correlation-1")),
    )
    .with_mutation_code(AgentMutationErrorCode::GitStatusChanged);

    assert_eq!(
        error.to_protocol_value(),
        json!({
            "code": "conflict",
            "correlationId": "correlation-1",
            "message": "Git status changed",
            "mutationCode": "GIT_STATUS_CHANGED"
        })
    );
}

#[test]
fn all_required_ports_should_be_object_safe() {
    fn assert_ports(
        _repository: Arc<dyn RepositoryPort>,
        _provider: Arc<dyn ProviderPort>,
        _git: Arc<dyn GitPort>,
        _file: Arc<dyn FilePort>,
        _attachment: Arc<dyn AttachmentPort>,
        _clock: Arc<dyn ClockPort>,
        _update: Arc<dyn UpdatePort>,
    ) {
    }

    let fake = Arc::new(FakePorts);
    assert_ports(
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake,
    );
}
