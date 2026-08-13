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
use code_agent_protocol::{AgentCapabilities, ProjectId, TaskId};
use code_agent_runtime::{
    CodeAgentRuntimeBuilder, IdempotencyRegistry, OperationRegistry, RuntimeOptions,
};
use serde_json::{Value, json};

struct FakePorts;

#[async_trait]
impl RepositoryPort for FakePorts {
    async fn read_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        Ok(None)
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
        Ok(json!({}))
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

fn build_runtime() -> code_agent_runtime::CodeAgentRuntime {
    let fake = Arc::new(FakePorts);
    CodeAgentRuntimeBuilder::new(RuntimeOptions {
        idempotency_capacity: 4,
        idempotency_ttl: Duration::from_secs(60),
        operation_capacity: 2,
        shutdown_timeout: Duration::from_secs(1),
        temporary_project_root: None,
    })
    .repository(fake.clone())
    .provider(fake.clone())
    .git(fake.clone())
    .file(fake.clone())
    .attachment(fake.clone())
    .clock(fake.clone())
    .update(fake)
    .build()
}

#[tokio::test]
async fn operation_registry_should_enforce_capacity_identity_and_cancellation() {
    let registry = OperationRegistry::new(1);
    let context = registry.begin("request-1").await.expect("first request");

    assert!(registry.begin("request-1").await.is_err());
    assert!(registry.begin("request-2").await.is_err());
    assert!(registry.cancel("request-1").await);
    assert!(context.is_cancelled());
    drop(context);
    assert!(registry.begin("request-2").await.is_ok());
    registry.close().await;
    assert!(registry.begin("request-3").await.is_err());
}

#[tokio::test]
async fn operation_registry_should_release_capacity_when_operation_is_dropped() {
    let registry = OperationRegistry::new(1);
    {
        let _operation = registry.begin("request-1").await.expect("first request");
    }

    assert!(registry.begin("request-1").await.is_ok());
}

#[tokio::test]
async fn runtime_should_release_operation_after_protocol_validation_failure() {
    let runtime = build_runtime();
    let project_id = ProjectId::try_from("project-1").expect("project id");

    for _ in 0..2 {
        let error = runtime
            .start_agent_turn("invalid-turn", &project_id, "task-1", json!({}))
            .await
            .expect_err("invalid request");
        assert_eq!(error.code(), CodeAgentErrorCode::InvalidInput);
    }
}

#[tokio::test]
async fn idempotency_registry_should_reuse_success_and_reject_payload_conflict() {
    let registry = IdempotencyRegistry::new(2, Duration::from_millis(5));
    let calls = Arc::new(AtomicUsize::new(0));
    let execute = || {
        let calls = calls.clone();
        async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(json!({ "ok": true }))
        }
    };

    let first = registry
        .execute("start_task", "key-1", &json!({ "input": "same" }), execute)
        .await;
    let second = registry
        .execute("start_task", "key-1", &json!({ "input": "same" }), execute)
        .await;
    let conflict = registry
        .execute(
            "start_task",
            "key-1",
            &json!({ "input": "different" }),
            execute,
        )
        .await;

    assert_eq!(first, second);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(conflict.is_err());

    tokio::time::sleep(Duration::from_millis(20)).await;
    let expired = registry
        .execute("start_task", "key-1", &json!({ "input": "same" }), execute)
        .await;
    assert_eq!(expired, first);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn idempotency_registry_should_share_in_flight_and_not_cache_failure() {
    let registry = Arc::new(IdempotencyRegistry::new(2, Duration::from_secs(60)));
    let calls = Arc::new(AtomicUsize::new(0));
    let run = |registry: Arc<IdempotencyRegistry>| {
        let calls = calls.clone();
        tokio::spawn(async move {
            registry
                .execute("operation", "key", &json!({}), || async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    Ok(json!(1))
                })
                .await
        })
    };

    let (first, second) = tokio::join!(run(registry.clone()), run(registry.clone()));
    assert_eq!(first.expect("first task"), second.expect("second task"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let failed = registry
        .execute("failure", "key", &json!({}), || async {
            Err(CodeAgentError::internal("failed"))
        })
        .await;
    let retried = registry
        .execute("failure", "key", &json!({}), || async { Ok(json!(2)) })
        .await;
    assert!(failed.is_err());
    assert_eq!(retried.expect("retry succeeds"), json!(2));
}

#[tokio::test]
async fn runtime_shutdown_should_be_idempotent_and_reject_new_operations() {
    let runtime = build_runtime();
    let context = runtime
        .begin_operation("request-1")
        .await
        .expect("operation");
    let (stopped_sender, stopped_receiver) = tokio::sync::oneshot::channel();
    runtime.spawn_tracked(|shutdown| async move {
        shutdown.cancelled().await;
        let _ = stopped_sender.send(());
    });

    runtime.shutdown().await.expect("first shutdown");
    runtime.shutdown().await.expect("second shutdown");

    assert!(context.is_cancelled());
    assert!(stopped_receiver.await.is_ok());
    assert!(runtime.begin_operation("request-2").await.is_err());
    assert!(
        runtime
            .idempotency()
            .execute("operation", "key", &json!({}), || async { Ok(json!(1)) })
            .await
            .is_err()
    );
}
