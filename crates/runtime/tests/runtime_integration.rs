use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{
    AttachmentPort, ClockPort, CodeAgentError, CodeAgentErrorCode, FilePort, GitPort,
    PortRequestContext, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_protocol::{
    AgentCapabilities, AgentGlobalSettings, AgentProjectDefaults, ProjectId, TaskId,
    parse_provider_event,
};
use code_agent_runtime::{
    AgentEventStream, CodeAgentRuntime, CodeAgentRuntimeBuilder, EventReplay, EventStreamOptions,
    RuntimeOptions,
};
use serde_json::{Value, json};

#[derive(Clone, Copy)]
enum ProviderBehavior {
    Fail,
    Succeed,
    WaitForCancellation,
}

struct FakePorts {
    file_close_calls: AtomicUsize,
    file_release_calls: AtomicUsize,
    provider_behavior: ProviderBehavior,
}

impl FakePorts {
    fn new(provider_behavior: ProviderBehavior) -> Self {
        Self {
            file_close_calls: AtomicUsize::new(0),
            file_release_calls: AtomicUsize::new(0),
            provider_behavior,
        }
    }
}

fn capabilities_fixture() -> Result<AgentCapabilities, CodeAgentError> {
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

#[async_trait]
impl RepositoryPort for FakePorts {
    async fn read_project(
        &self,
        project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        Ok(Some(json!({ "id": project_id.to_string() })))
    }

    async fn read_global_settings(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentGlobalSettings>, CodeAgentError> {
        Ok(None)
    }

    async fn read_project_defaults(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentProjectDefaults>, CodeAgentError> {
        Ok(None)
    }
}

#[async_trait]
impl ProviderPort for FakePorts {
    async fn capabilities(
        &self,
        context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        match self.provider_behavior {
            ProviderBehavior::Fail => Err(CodeAgentError::new(
                CodeAgentErrorCode::ProviderFailure,
                "fake provider failed",
                None,
            )),
            ProviderBehavior::Succeed => capabilities_fixture(),
            ProviderBehavior::WaitForCancellation => {
                context.cancelled().await;
                Err(CodeAgentError::new(
                    CodeAgentErrorCode::Cancelled,
                    "provider operation cancelled",
                    None,
                ))
            }
        }
    }

    async fn models(
        &self,
        _context: &PortRequestContext,
    ) -> Result<code_agent_protocol::AgentModelPage, CodeAgentError> {
        serde_json::from_value(json!({
            "data": [{
                "defaultReasoningEffort": "medium",
                "description": "Default model",
                "displayName": "GPT Test",
                "id": "gpt-test",
                "isDefault": true,
                "supportedReasoningEfforts": [
                    { "description": "Low", "id": "low" },
                    { "description": "Medium", "id": "medium" }
                ]
            }],
            "nextCursor": null
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn default_settings(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({
            "config": {
                "approval_policy": "never",
                "model": "gpt-test",
                "model_reasoning_effort": "low",
                "sandbox_mode": "read-only"
            }
        }))
    }
}

#[async_trait]
impl GitPort for FakePorts {
    async fn status(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({}))
    }
}

#[async_trait]
impl FilePort for FakePorts {
    async fn release_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.file_release_calls.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    async fn close(&self) -> Result<(), CodeAgentError> {
        self.file_close_calls.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    async fn read(
        &self,
        _project_id: &ProjectId,
        _path: &str,
        _context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        Ok(Vec::new())
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
        Ok(Vec::new())
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

fn build_runtime(provider_behavior: ProviderBehavior) -> CodeAgentRuntime {
    let fake = Arc::new(FakePorts::new(provider_behavior));
    build_runtime_with_ports(fake).0
}

fn build_runtime_with_ports(fake: Arc<FakePorts>) -> (CodeAgentRuntime, Arc<FakePorts>) {
    let runtime = CodeAgentRuntimeBuilder::new(RuntimeOptions {
        idempotency_capacity: 4,
        idempotency_ttl: Duration::from_secs(60),
        operation_capacity: 4,
        shutdown_timeout: Duration::from_secs(1),
        temporary_project_root: None,
    })
    .repository(fake.clone())
    .provider(fake.clone())
    .git(fake.clone())
    .file(fake.clone())
    .attachment(fake.clone())
    .clock(fake.clone())
    .update(fake.clone())
    .build();
    (runtime, fake)
}

#[tokio::test]
async fn runtime_should_route_success_and_failure_through_ports() {
    let success = build_runtime(ProviderBehavior::Succeed);
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let project = success
        .read_project("read-project", &project_id)
        .await
        .expect("project")
        .expect("present");
    assert_eq!(project["id"], "project-1");
    assert_eq!(
        success
            .capabilities("capabilities")
            .await
            .expect("capabilities")
            .provider
            .as_str(),
        "fake"
    );

    let failure = build_runtime(ProviderBehavior::Fail);
    let error = failure
        .capabilities("failed-capabilities")
        .await
        .expect_err("provider failure");
    assert_eq!(error.code(), CodeAgentErrorCode::ProviderFailure);
}

#[tokio::test]
async fn runtime_should_resolve_effective_settings_when_repository_is_empty() {
    let runtime = build_runtime(ProviderBehavior::Succeed);
    let project_id = ProjectId::try_from("project-1").expect("project id");

    let global = runtime
        .effective_global_settings("global-settings")
        .await
        .expect("effective global settings");
    let project = runtime
        .effective_project_defaults("project-defaults", &project_id)
        .await
        .expect("effective project defaults");

    let global = serde_json::to_value(global).expect("serialize global settings");
    let project = serde_json::to_value(project).expect("serialize project defaults");
    assert_eq!(global["approvalPolicy"], "never");
    assert_eq!(global["model"], "gpt-test");
    assert_eq!(global["reasoningEffort"], "low");
    assert_eq!(global["sandboxMode"], "read-only");
    assert_eq!(global["commitMessagePrompt"], "");
    assert_eq!(
        project,
        json!({
            "model": "gpt-test",
            "reasoningEffort": "low",
            "sandboxMode": "read-only"
        })
    );
}

#[tokio::test]
async fn runtime_should_cancel_in_flight_provider_operation() {
    let runtime = Arc::new(build_runtime(ProviderBehavior::WaitForCancellation));
    let operation = {
        let runtime = runtime.clone();
        tokio::spawn(async move { runtime.capabilities("slow-request").await })
    };
    tokio::task::yield_now().await;

    assert!(runtime.cancel_operation("slow-request").await);
    let error = operation
        .await
        .expect("provider task")
        .expect_err("cancelled operation");
    assert_eq!(error.code(), CodeAgentErrorCode::Cancelled);
}

#[tokio::test]
async fn runtime_should_release_and_close_file_port_state() {
    let fake = Arc::new(FakePorts::new(ProviderBehavior::Succeed));
    let (runtime, fake) = build_runtime_with_ports(fake);
    let project_id = ProjectId::try_from("project-1").expect("project id");

    runtime
        .release_project_context("release-files", &project_id)
        .await
        .expect("release project files");
    runtime.shutdown().await.expect("runtime shutdown");

    assert_eq!(fake.file_release_calls.load(Ordering::Relaxed), 1);
    assert_eq!(fake.file_close_calls.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn validated_provider_event_should_flow_through_replay_and_shutdown() {
    let stream = AgentEventStream::new(EventStreamOptions {
        capacity: 8,
        max_event_bytes: 1_024,
        max_retained_bytes: 4_096,
        now: Arc::new(|| DateTime::UNIX_EPOCH),
        provider: Arc::from("fake"),
        session_id: Arc::from("session-1"),
        subscriber_capacity: 2,
    })
    .expect("event stream");
    let event = parse_provider_event(json!({
        "itemId": "item-1",
        "payload": { "delta": "hello" },
        "taskId": "task-1",
        "turnId": "turn-1",
        "type": "message.delta"
    }))
    .expect("provider event");

    stream.publish(event).await;
    let checkpoint = stream.checkpoint().await;
    let EventReplay::Events(events) = stream.replay_after("session-1", 0).await else {
        panic!("expected replay")
    };
    assert_eq!(checkpoint.sequence, 1);
    assert_eq!(events[0].value()["payload"]["delta"], "hello");

    stream.close().await;
    assert!(stream.subscribe().await.is_err());
}
