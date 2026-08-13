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
    AttachmentPort, ClockPort, CodeAgentError, FilePort, GitPort, PortRequestContext,
    ProjectProviderPort, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_protocol::{
    AgentAttachment, AgentBackgroundTerminalPage, AgentCapabilities, AgentGlobalSettings,
    AgentMcpServerPage, AgentSkillPage, AgentTaskPage, Project, ProjectId, RawProviderEvent,
    TaskId,
};
use code_agent_runtime::{CodeAgentRuntime, CodeAgentRuntimeBuilder, RuntimeOptions};
use serde_json::{Value, json};
use tokio::sync::mpsc;

#[derive(Default)]
struct MutationCounters {
    commit: AtomicUsize,
    fork: AtomicUsize,
    global_settings: AtomicUsize,
    login: AtomicUsize,
    review: AtomicUsize,
}

struct FakePorts {
    counters: Arc<MutationCounters>,
}

impl FakePorts {
    fn unavailable<T>() -> Result<T, CodeAgentError> {
        Err(CodeAgentError::internal(
            "fake port operation is unavailable",
        ))
    }
}

#[async_trait]
impl RepositoryPort for FakePorts {
    async fn read_project(
        &self,
        project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        Ok(Some(json!({
            "createdAt": "2026-08-13T00:00:00Z",
            "id": project_id,
            "name": "Project",
            "rootPath": format!("/workspace/{}", project_id.as_str()),
        })))
    }

    async fn write_global_settings(
        &self,
        settings: &AgentGlobalSettings,
        _updated_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        self.counters.global_settings.fetch_add(1, Ordering::SeqCst);
        Ok(settings.clone())
    }
}

#[async_trait]
impl ProviderPort for FakePorts {
    async fn capabilities(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        serde_json::from_value(json!({
            "feedback": { "upload": true },
            "provider": "fake",
            "skills": { "list": true, "use": true },
            "tasks": { "fork": true, "list": true, "read": true, "start": true },
            "turns": {
                "compact": true, "interrupt": true, "review": true,
                "start": true, "steer": true
            }
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn start_official_login(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.counters.login.fetch_add(1, Ordering::SeqCst);
        Ok(json!({ "loginId": "login-1" }))
    }

    async fn for_project(
        &self,
        _project: Project,
        _context: &PortRequestContext,
    ) -> Result<Arc<dyn ProjectProviderPort>, CodeAgentError> {
        Ok(Arc::new(Self {
            counters: Arc::clone(&self.counters),
        }))
    }
}

#[async_trait]
impl ProjectProviderPort for FakePorts {
    async fn start_task(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Self::unavailable()
    }

    async fn list_tasks(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        Self::unavailable()
    }

    async fn read_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        Self::unavailable()
    }

    async fn pin_task(
        &self,
        _task_id: &str,
        _pinned: bool,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Self::unavailable()
    }

    async fn rename_task(
        &self,
        _task_id: &str,
        _title: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Self::unavailable()
    }

    async fn archive_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Self::unavailable()
    }

    async fn fork_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.counters.fork.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;
        Ok(json!({ "id": format!("{task_id}-fork") }))
    }

    async fn compact_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Self::unavailable()
    }

    async fn unsubscribe_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        Self::unavailable()
    }

    async fn start_turn(
        &self,
        _task_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Self::unavailable()
    }

    async fn steer_turn(
        &self,
        _task_id: &str,
        _turn_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Self::unavailable()
    }

    async fn interrupt_turn(
        &self,
        _task_id: &str,
        _turn_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Self::unavailable()
    }

    async fn start_review(
        &self,
        task_id: &str,
        target: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.counters.review.fetch_add(1, Ordering::SeqCst);
        Ok(json!({ "id": "review-1", "target": target, "taskId": task_id }))
    }

    async fn resolve_pending_request(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Self::unavailable()
    }

    async fn list_skills(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        Self::unavailable()
    }

    async fn list_mcp_servers(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        Self::unavailable()
    }

    async fn reload_mcp_servers(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        Self::unavailable()
    }

    async fn list_background_terminals(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        Self::unavailable()
    }

    async fn terminate_background_terminal(
        &self,
        _task_id: &str,
        _terminal_id: &str,
        _context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError> {
        Self::unavailable()
    }

    async fn upload_feedback(
        &self,
        _task_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Self::unavailable()
    }

    async fn subscribe_events(
        &self,
        _include_ephemeral: bool,
        _context: &PortRequestContext,
    ) -> Result<mpsc::Receiver<RawProviderEvent>, CodeAgentError> {
        let (_sender, receiver) = mpsc::channel(1);
        Ok(receiver)
    }
}

#[async_trait]
impl GitPort for FakePorts {
    async fn status(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Self::unavailable()
    }

    async fn commit(
        &self,
        project_id: &ProjectId,
        request: &Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.counters.commit.fetch_add(1, Ordering::SeqCst);
        Ok(json!({ "projectId": project_id, "request": request }))
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
        Self::unavailable()
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
        Self::unavailable()
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
        Self::unavailable()
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

fn runtime() -> (Arc<MutationCounters>, CodeAgentRuntime) {
    let counters = Arc::new(MutationCounters::default());
    let ports = Arc::new(FakePorts {
        counters: Arc::clone(&counters),
    });
    let runtime = CodeAgentRuntimeBuilder::new(RuntimeOptions {
        idempotency_capacity: 16,
        idempotency_ttl: Duration::from_secs(60),
        operation_capacity: 16,
        shutdown_timeout: Duration::from_secs(1),
        temporary_project_root: None,
    })
    .repository(ports.clone())
    .provider(ports.clone())
    .git(ports.clone())
    .file(ports.clone())
    .attachment(ports.clone())
    .clock(ports.clone())
    .update(ports)
    .build();
    (counters, runtime)
}

fn global_settings() -> AgentGlobalSettings {
    serde_json::from_value(json!({
        "approvalPolicy": "on-request",
        "approvalsReviewer": "user",
        "commitMessageModel": "gpt-5.6",
        "commitMessagePrompt": "",
        "commitMessageReasoningEffort": "high",
        "defaultOpenAppId": null,
        "followUpBehavior": "queue",
        "model": "gpt-5.6",
        "reasoningEffort": "high",
        "sandboxMode": "workspace-write"
    }))
    .expect("global settings")
}

#[tokio::test]
async fn representative_mutation_retries_should_execute_each_port_once() {
    let (counters, runtime) = runtime();
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let settings = global_settings();
    let commit = json!({ "expectedSnapshot": "snapshot", "message": "message" });
    let review = json!({ "type": "uncommittedChanges" });

    for _ in 0..2 {
        runtime
            .update_global_settings("settings-key", &settings)
            .await
            .expect("update settings");
        runtime
            .start_provider_login("login-key")
            .await
            .expect("start login");
        runtime
            .start_agent_review("review-key", &project_id, "task-1", review.clone())
            .await
            .expect("start review");
        runtime
            .git_commit("commit-key", &project_id, &commit)
            .await
            .expect("commit");
    }

    assert_eq!(counters.global_settings.load(Ordering::SeqCst), 1);
    assert_eq!(counters.login.load(Ordering::SeqCst), 1);
    assert_eq!(counters.review.load(Ordering::SeqCst), 1);
    assert_eq!(counters.commit.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn concurrent_task_mutation_retries_should_share_in_flight_result() {
    let (counters, runtime) = runtime();
    let runtime = Arc::new(runtime);
    let project_id = ProjectId::try_from("project-1").expect("project id");

    let (first, second) = tokio::join!(
        runtime.fork_agent_task("fork-key", &project_id, "task-1"),
        runtime.fork_agent_task("fork-key", &project_id, "task-1"),
    );

    assert_eq!(first.expect("first fork"), second.expect("second fork"));
    assert_eq!(counters.fork.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn same_request_key_should_execute_independently_across_projects() {
    let (counters, runtime) = runtime();
    let project_one = ProjectId::try_from("project-1").expect("first project id");
    let project_two = ProjectId::try_from("project-2").expect("second project id");
    let commit = json!({ "expectedSnapshot": "snapshot", "message": "message" });

    let (first, second) = tokio::join!(
        runtime.git_commit("shared-key", &project_one, &commit),
        runtime.git_commit("shared-key", &project_two, &commit),
    );

    first.expect("first project commit");
    second.expect("second project commit");
    assert_eq!(counters.commit.load(Ordering::SeqCst), 2);
}
