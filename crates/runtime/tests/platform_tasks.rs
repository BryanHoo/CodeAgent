use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{
    AttachmentPort, ClockPort, CodeAgentError, CodeAgentErrorCode, FilePort, GitPort,
    ManagedAttachment, PortRequestContext, ProjectProviderPort, ProviderPort, RepositoryPort,
    UpdatePort,
};
use code_agent_protocol::{
    AgentBackgroundTerminalPage, AgentCapabilities, AgentGlobalSettings, AgentMcpServerPage,
    AgentModelPage, AgentProjectDefaults, AgentSkillPage, AgentTaskPage, AgentTaskSettings,
    GenerateCommitMessageRequest, Project, ProjectId, ProviderEvent, TaskId, parse_provider_event,
};
use code_agent_runtime::{
    CodeAgentRuntime, CodeAgentRuntimeBuilder, EventReplay, PublishedEvent, RuntimeOptions,
};
use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc};

fn published_value(event: &PublishedEvent) -> Value {
    serde_json::from_slice(event.frame()).expect("valid published event frame")
}

struct FakeProjectProvider {
    event_subscribers: Mutex<Vec<(bool, mpsc::Sender<ProviderEvent>)>>,
    fail_start_turn: AtomicBool,
    start_task_input: Mutex<Option<Value>>,
    start_turn_input: Mutex<Option<Value>>,
    subscription_modes: Mutex<Vec<bool>>,
    unsubscribe_calls: AtomicUsize,
}

impl FakeProjectProvider {
    async fn publish(&self, event: ProviderEvent, ephemeral: bool) {
        self.event_subscribers
            .lock()
            .await
            .retain(|(include_ephemeral, sender)| {
                if ephemeral && !*include_ephemeral {
                    return !sender.is_closed();
                }
                sender.try_send(event.clone()).is_ok()
            });
    }
}

#[async_trait]
impl ProjectProviderPort for FakeProjectProvider {
    async fn start_task(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        *self.start_task_input.lock().await = Some(input);
        Ok(json!({ "id": "task-1" }))
    }
    async fn list_tasks(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        serde_json::from_value(json!({ "data": [], "nextCursor": null }))
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn read_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        Ok(Some(json!({
            "contextUsage": null,
            "id": task_id,
            "pendingRequests": [],
            "pinned": false,
            "plan": null,
            "projectId": "project-1",
            "status": "idle",
            "title": "共享实时任务",
            "turns": [],
            "updatedAt": "2026-08-12T00:00:00Z"
        })))
    }
    async fn read_task_attachment(
        &self,
        task_id: &str,
        attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<code_agent_core::AttachmentBytes>, CodeAgentError> {
        Ok(
            (task_id == "task-1" && attachment_id == "history-attachment")
                .then(|| b"historical bytes".to_vec().into()),
        )
    }
    async fn pin_task(
        &self,
        _task_id: &str,
        _pinned: bool,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({}))
    }
    async fn rename_task(
        &self,
        _task_id: &str,
        _title: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }
    async fn archive_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }
    async fn fork_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({}))
    }
    async fn compact_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }
    async fn unsubscribe_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        self.unsubscribe_calls.fetch_add(1, Ordering::SeqCst);
        Ok("unsubscribed".to_string())
    }
    async fn start_turn(
        &self,
        _task_id: &str,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        *self.start_turn_input.lock().await = Some(input);
        if self.fail_start_turn.load(Ordering::SeqCst) {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::ProviderFailure,
                "start turn failed",
                None,
            ));
        }
        let ephemeral = self
            .start_task_input
            .lock()
            .await
            .as_ref()
            .is_some_and(|input| input["ephemeral"] == true);
        self.publish(
            parse_provider_event(json!({
                "itemId": "message-1",
                "payload": { "item": {
                    "id": "message-1", "role": "assistant",
                    "text": "{\"message\":\"feat(runtime): 生成提交信息\"}", "type": "message"
                } },
                "taskId": "task-1", "turnId": "turn-1", "type": "item.completed"
            }))
            .expect("completed item"),
            ephemeral,
        )
        .await;
        self.publish(
            parse_provider_event(json!({
                "payload": { "turn": {
                    "completedAt": "2026-08-12T00:00:02.000Z", "error": null,
                    "id": "turn-1", "items": [],
                    "startedAt": "2026-08-12T00:00:01.000Z", "status": "completed"
                } },
                "taskId": "task-1", "turnId": "turn-1", "type": "turn.completed"
            }))
            .expect("completed turn"),
            ephemeral,
        )
        .await;
        Ok(json!({
            "completedAt": null, "error": null, "id": "turn-1",
            "items": [], "startedAt": "2026-08-12T00:00:01.000Z", "status": "running"
        }))
    }
    async fn steer_turn(
        &self,
        _task_id: &str,
        _turn_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }
    async fn interrupt_turn(
        &self,
        _task_id: &str,
        _turn_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }
    async fn start_review(
        &self,
        _task_id: &str,
        _target: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({}))
    }
    async fn resolve_pending_request(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(input)
    }
    async fn list_skills(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        serde_json::from_value(json!({ "data": [], "nextCursor": null }))
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn list_mcp_servers(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        serde_json::from_value(json!({ "data": [] }))
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn reload_mcp_servers(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.list_mcp_servers(task_id, context).await
    }
    async fn list_background_terminals(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        serde_json::from_value(json!({ "data": [] }))
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn terminate_background_terminal(
        &self,
        _task_id: &str,
        _terminal_id: &str,
        _context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError> {
        Ok(true)
    }
    async fn upload_feedback(
        &self,
        _task_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        Ok(())
    }
    async fn subscribe_events(
        &self,
        include_ephemeral: bool,
        _context: &PortRequestContext,
    ) -> Result<mpsc::Receiver<ProviderEvent>, CodeAgentError> {
        self.subscription_modes.lock().await.push(include_ephemeral);
        let (sender, receiver) = mpsc::channel(8);
        self.event_subscribers
            .lock()
            .await
            .push((include_ephemeral, sender));
        Ok(receiver)
    }
}

struct FakePorts {
    attachment_bind_calls: AtomicUsize,
    attachment_release_calls: AtomicUsize,
    for_project_calls: AtomicUsize,
    models_calls: AtomicUsize,
    project_provider: Arc<FakeProjectProvider>,
    release_calls: AtomicUsize,
    task_settings: Mutex<Option<AgentTaskSettings>>,
    temporary_calls: AtomicUsize,
}

impl FakePorts {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            attachment_bind_calls: AtomicUsize::new(0),
            attachment_release_calls: AtomicUsize::new(0),
            for_project_calls: AtomicUsize::new(0),
            models_calls: AtomicUsize::new(0),
            project_provider: Arc::new(FakeProjectProvider {
                event_subscribers: Mutex::new(Vec::new()),
                fail_start_turn: AtomicBool::new(false),
                start_task_input: Mutex::new(None),
                start_turn_input: Mutex::new(None),
                subscription_modes: Mutex::new(Vec::new()),
                unsubscribe_calls: AtomicUsize::new(0),
            }),
            release_calls: AtomicUsize::new(0),
            task_settings: Mutex::new(Some(
                serde_json::from_value(json!({
                    "approvalPolicy": "on-request", "approvalsReviewer": "user",
                    "model": "sqlite-model", "reasoningEffort": "high",
                    "sandboxMode": "workspace-write"
                }))
                .expect("task settings"),
            )),
            temporary_calls: AtomicUsize::new(0),
        })
    }
}

#[async_trait]
impl RepositoryPort for FakePorts {
    async fn read_project(
        &self,
        project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        if project_id.as_str() == "temporary" {
            return Ok(None);
        }
        Ok(Some(
            json!({ "createdAt": "2026-08-12T00:00:00Z", "id": project_id, "name": "Project", "rootPath": "/workspace" }),
        ))
    }

    async fn ensure_temporary_project(
        &self,
        root_path: &str,
        _created_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<Project, CodeAgentError> {
        self.temporary_calls.fetch_add(1, Ordering::SeqCst);
        serde_json::from_value(json!({
            "createdAt": "2026-08-12T00:00:00Z", "id": "temporary",
            "name": "Temporary", "rootPath": root_path
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn read_global_settings(
        &self,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentGlobalSettings>, CodeAgentError> {
        serde_json::from_value(json!({
            "approvalPolicy": "on-request", "approvalsReviewer": "user",
            "commitMessageModel": "gpt-5.6", "commitMessagePrompt": "使用中文",
            "commitMessageReasoningEffort": "high", "defaultOpenAppId": null,
            "followUpBehavior": "queue", "model": "gpt-5.6",
            "reasoningEffort": "high", "sandboxMode": "workspace-write"
        }))
        .map(Some)
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn read_task_settings(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _context: &PortRequestContext,
    ) -> Result<Option<AgentTaskSettings>, CodeAgentError> {
        Ok(self.task_settings.lock().await.clone())
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
        _context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        serde_json::from_value(json!({ "feedback": { "upload": true }, "provider": "fake", "skills": { "list": true, "use": true }, "tasks": { "fork": true, "list": true, "read": true, "start": true }, "turns": { "compact": true, "interrupt": true, "review": true, "start": true, "steer": true } })).map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn models(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentModelPage, CodeAgentError> {
        self.models_calls.fetch_add(1, Ordering::SeqCst);
        serde_json::from_value(json!({
            "data": [{
                "defaultReasoningEffort": "high",
                "description": "Default model",
                "displayName": "GPT 5.6",
                "id": "gpt-5.6",
                "isDefault": true,
                "supportedReasoningEfforts": [{ "description": "High", "id": "high" }]
            }],
            "nextCursor": null
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
    async fn for_project(
        &self,
        _project: Project,
        _context: &PortRequestContext,
    ) -> Result<Arc<dyn ProjectProviderPort>, CodeAgentError> {
        self.for_project_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.project_provider.clone())
    }
    async fn release_project(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.release_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[async_trait]
impl GitPort for FakePorts {
    async fn status(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Ok(json!({
            "baseBranches": ["main"], "branch": "feat/runtime", "branches": ["feat/runtime"],
            "repositoryMode": "root", "snapshot": "a".repeat(64), "staged": [],
            "unstaged": [{ "diff": "@@\n-old\n+new", "kind": "update", "path": "src/app.rs" }]
        }))
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
    async fn resolve_pending(
        &self,
        _project_id: &ProjectId,
        attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<ManagedAttachment, CodeAgentError> {
        if attachment_id != "attachment-1" {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::NotFound,
                "attachment was not found",
                None,
            ));
        }
        serde_json::from_value(json!({
            "id": "attachment-1", "kind": "text", "mediaType": "text/plain",
            "name": "notes.txt", "size": 5
        }))
        .map(|attachment| ManagedAttachment {
            attachment,
            path: "/managed/notes.txt".to_owned(),
        })
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn bind_to_turn(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _turn_id: &str,
        _attachment_ids: &[String],
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.attachment_bind_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn release_turn(
        &self,
        _project_id: &ProjectId,
        _turn_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.attachment_release_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn read(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        Err(CodeAgentError::new(
            CodeAgentErrorCode::NotFound,
            "attachment was not found",
            None,
        ))
    }
}

#[tokio::test]
async fn prompt_attachments_should_bind_only_after_provider_accepts_turn() {
    let fake = FakePorts::new();
    let runtime = runtime(fake.clone());
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let request = json!({
        "input": {
            "attachments": [{ "id": "attachment-1" }],
            "skills": [], "text": "check", "type": "prompt"
        },
        "options": {
            "approvalPolicy": "on-request", "approvalsReviewer": "user",
            "model": "gpt-5.6", "reasoningEffort": "high",
            "sandboxMode": "workspace-write"
        }
    });

    runtime
        .start_agent_turn(
            "prompt-success",
            "prompt-success",
            &project_id,
            "task-1",
            request.clone(),
        )
        .await
        .expect("start turn");
    let provider_input = fake
        .project_provider
        .start_turn_input
        .lock()
        .await
        .clone()
        .expect("provider input");
    assert_eq!(
        provider_input["prompt"]["attachments"][0]["path"],
        "/managed/notes.txt"
    );
    assert_eq!(fake.attachment_bind_calls.load(Ordering::SeqCst), 1);

    fake.project_provider
        .fail_start_turn
        .store(true, Ordering::SeqCst);
    assert!(
        runtime
            .start_agent_turn(
                "prompt-failure",
                "prompt-failure",
                &project_id,
                "task-1",
                request,
            )
            .await
            .is_err()
    );
    assert_eq!(fake.attachment_bind_calls.load(Ordering::SeqCst), 1);
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
        Ok("1.9.0".to_string())
    }
}

fn runtime_with_temporary_root(
    fake: Arc<FakePorts>,
    temporary_project_root: Option<std::path::PathBuf>,
) -> CodeAgentRuntime {
    CodeAgentRuntimeBuilder::new(RuntimeOptions {
        idempotency_capacity: 8,
        idempotency_ttl: Duration::from_secs(60),
        operation_capacity: 8,
        shutdown_timeout: Duration::from_secs(1),
        temporary_project_root,
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

fn runtime(fake: Arc<FakePorts>) -> CodeAgentRuntime {
    runtime_with_temporary_root(fake, None)
}

#[tokio::test]
async fn project_context_should_initialize_once_and_forward_events() {
    let fake = FakePorts::new();
    let runtime = Arc::new(runtime(fake.clone()));
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let (left, right) = tokio::join!(
        runtime.list_agent_tasks("list-left", &project_id, json!({})),
        runtime.list_agent_tasks("list-right", &project_id, json!({}))
    );
    left.expect("left list");
    right.expect("right list");
    assert_eq!(fake.for_project_calls.load(Ordering::SeqCst), 1);

    fake.project_provider.publish(parse_provider_event(json!({ "itemId": "item-1", "payload": { "delta": "hello" }, "taskId": "task-1", "turnId": "turn-1", "type": "message.delta" })).expect("event"), false).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let EventReplay::Events(events) = runtime
        .replay_project_events("replay", &project_id, "", 0)
        .await
        .expect("replay")
    else {
        panic!("events")
    };
    assert_eq!(published_value(&events[0])["payload"]["delta"], "hello");

    runtime
        .release_project_context("release", &project_id)
        .await
        .expect("release");
    assert_eq!(fake.release_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn project_context_release_should_wait_for_active_event_subscription() {
    let fake = FakePorts::new();
    let runtime = Arc::new(runtime(fake.clone()));
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let subscription_id = runtime
        .start_leased_project_event_subscription(
            &tokio::runtime::Handle::current(),
            "subscribe".to_owned(),
            project_id.clone(),
            "lease-active".to_owned(),
            String::new(),
            0,
            |_| std::future::ready(true),
        )
        .expect("start subscription");
    while fake.for_project_calls.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }

    let release_runtime = Arc::clone(&runtime);
    let release_project_id = project_id.clone();
    let mut release = tokio::spawn(async move {
        release_runtime
            .release_project_context_lease("release-active", &release_project_id, "lease-active")
            .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut release)
            .await
            .is_err()
    );

    assert!(runtime.cancel_event_subscription(&subscription_id));
    release
        .await
        .expect("release task")
        .expect("release context");
    assert_eq!(fake.release_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn stale_project_context_lease_should_not_release_a_new_subscription() {
    let fake = FakePorts::new();
    let runtime = Arc::new(runtime(fake.clone()));
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let first_subscription = runtime
        .start_leased_project_event_subscription(
            &tokio::runtime::Handle::current(),
            "subscribe-first".to_owned(),
            project_id.clone(),
            "lease-first".to_owned(),
            String::new(),
            0,
            |_| std::future::ready(true),
        )
        .expect("first subscription");
    let second_subscription = runtime
        .start_leased_project_event_subscription(
            &tokio::runtime::Handle::current(),
            "subscribe-second".to_owned(),
            project_id.clone(),
            "lease-second".to_owned(),
            String::new(),
            0,
            |_| std::future::ready(true),
        )
        .expect("second subscription");
    while fake.for_project_calls.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    tokio::task::yield_now().await;

    assert!(runtime.cancel_event_subscription(&first_subscription));
    let released = runtime
        .release_project_context_lease("release-first", &project_id, "lease-first")
        .await
        .expect("release first lease");
    assert!(!released);
    assert_eq!(fake.release_calls.load(Ordering::SeqCst), 0);

    assert!(runtime.cancel_event_subscription(&second_subscription));
    let released = runtime
        .release_project_context_lease("release-second", &project_id, "lease-second")
        .await
        .expect("release second lease");
    assert!(released);
    assert_eq!(fake.release_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn forced_project_context_release_should_close_an_active_subscription() {
    let fake = FakePorts::new();
    let runtime = Arc::new(runtime(fake.clone()));
    let project_id = ProjectId::try_from("project-1").expect("project id");
    runtime
        .start_leased_project_event_subscription(
            &tokio::runtime::Handle::current(),
            "subscribe-force".to_owned(),
            project_id.clone(),
            "lease-force".to_owned(),
            String::new(),
            0,
            |_| std::future::ready(true),
        )
        .expect("active subscription");
    while fake.for_project_calls.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }

    tokio::time::timeout(
        Duration::from_millis(100),
        runtime.release_project_context("release-force", &project_id),
    )
    .await
    .expect("forced release should not wait for renderer cleanup")
    .expect("force release");
    assert_eq!(fake.release_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn task_snapshot_should_merge_persisted_settings_and_flushed_checkpoint() {
    let fake = FakePorts::new();
    let runtime = runtime(fake.clone());
    let project_id = ProjectId::try_from("project-1").expect("project id");
    runtime
        .list_agent_tasks("initialize", &project_id, json!({}))
        .await
        .expect("initialize context");
    fake.project_provider
        .publish(
            parse_provider_event(json!({
                "itemId": "message-1", "payload": { "delta": "hello" },
                "taskId": "task-1", "turnId": "turn-1", "type": "message.delta"
            }))
            .expect("event"),
            false,
        )
        .await;
    tokio::time::sleep(Duration::from_millis(20)).await;

    let response = runtime
        .read_agent_task("read-task", &project_id, "task-1")
        .await
        .expect("read task")
        .expect("snapshot");
    assert_eq!(response["checkpoint"]["sequence"], 1);
    assert_eq!(response["snapshot"]["settings"]["model"], "sqlite-model");
    assert_eq!(
        response["snapshot"]["settings"]["sandboxMode"],
        "workspace-write"
    );
    assert_eq!(fake.models_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn task_snapshot_should_inherit_effective_settings_when_task_settings_are_missing() {
    let fake = FakePorts::new();
    *fake.task_settings.lock().await = None;
    let runtime = runtime(fake.clone());
    let project_id = ProjectId::try_from("project-1").expect("project id");

    let response = runtime
        .read_agent_task("read-history", &project_id, "task-1")
        .await
        .expect("read task")
        .expect("snapshot");

    assert_eq!(response["snapshot"]["settings"]["model"], "gpt-5.6");
    assert_eq!(
        response["snapshot"]["settings"]["approvalPolicy"],
        "on-request"
    );
    assert_eq!(
        response["snapshot"]["settings"]["sandboxMode"],
        "workspace-write"
    );
    assert_eq!(fake.models_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn phase5_shared_fixture_should_match_provider_runtime_delivery() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/phase5/realtime-path.json"
    ))
    .expect("phase 5 fixture");
    let fake = FakePorts::new();
    let runtime = runtime(fake.clone());
    let project_id = ProjectId::try_from("project-1").expect("project id");
    runtime
        .list_agent_tasks("fixture-initialize", &project_id, json!({}))
        .await
        .expect("initialize context");

    for expected in fixture["expectedEvents"]
        .as_array()
        .expect("expected events")
    {
        let event = parse_provider_event(expected.clone()).expect("provider event");
        fake.project_provider.publish(event, false).await;
    }
    tokio::time::sleep(Duration::from_millis(20)).await;

    let snapshot = runtime
        .read_agent_task("fixture-snapshot", &project_id, "task-1")
        .await
        .expect("read task")
        .expect("snapshot");
    let expected = &fixture["expectedSnapshotCore"];
    assert_eq!(
        snapshot["checkpoint"]["sequence"],
        expected["checkpointSequence"]
    );
    assert_eq!(snapshot["snapshot"]["id"], expected["taskId"]);
    assert_eq!(snapshot["snapshot"]["title"], expected["title"]);
    assert_eq!(snapshot["snapshot"]["status"], expected["status"]);
    assert_eq!(snapshot["snapshot"]["settings"]["model"], expected["model"]);
    assert_eq!(
        snapshot["snapshot"]["settings"]["sandboxMode"],
        expected["sandboxMode"]
    );

    let EventReplay::Events(events) = runtime
        .replay_project_events(
            "fixture-replay",
            &project_id,
            snapshot["checkpoint"]["sessionId"]
                .as_str()
                .expect("session"),
            0,
        )
        .await
        .expect("replay")
    else {
        panic!("expected events")
    };
    let event_types = events
        .iter()
        .map(|event| {
            published_value(event)["type"]
                .as_str()
                .expect("event type")
                .to_owned()
        })
        .collect::<Vec<_>>();
    let expected_types = fixture["expectedEventTypes"]
        .as_array()
        .expect("expected event types")
        .iter()
        .map(|value| value.as_str().expect("expected event type"))
        .collect::<Vec<_>>();
    assert_eq!(event_types, expected_types);
}

#[tokio::test]
async fn project_event_stream_should_exclude_ephemeral_tasks() {
    let fake = FakePorts::new();
    let runtime = runtime(fake.clone());
    let project_id = ProjectId::try_from("project-1").expect("project id");

    runtime
        .list_agent_tasks("initialize-events", &project_id, json!({}))
        .await
        .expect("initialize project events");

    assert_eq!(
        *fake.project_provider.subscription_modes.lock().await,
        vec![false]
    );
}

#[tokio::test]
async fn commit_message_should_use_ephemeral_read_only_turn_and_cleanup() {
    let fake = FakePorts::new();
    let runtime = runtime(fake.clone());
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let request: GenerateCommitMessageRequest = serde_json::from_value(json!({
        "expectedSnapshot": "a".repeat(64), "paths": ["src/app.rs"]
    }))
    .expect("request");

    let response = runtime
        .generate_commit_message("commit-message", "commit-message", &project_id, &request)
        .await
        .expect("generated message");
    assert_eq!(response.message.as_str(), "feat(runtime): 生成提交信息");
    assert_eq!(response.snapshot.as_str(), "a".repeat(64));
    assert_eq!(
        fake.project_provider
            .start_task_input
            .lock()
            .await
            .as_ref()
            .expect("start task")["ephemeral"],
        true
    );
    let turn = fake
        .project_provider
        .start_turn_input
        .lock()
        .await
        .clone()
        .expect("start turn");
    assert_eq!(turn["approvalPolicy"], "never");
    assert_eq!(turn["sandboxPolicy"]["type"], "readOnly");
    assert!(
        turn["input"][0]["text"]
            .as_str()
            .expect("prompt")
            .contains("使用中文")
    );
    assert_eq!(
        fake.project_provider
            .unsubscribe_calls
            .load(Ordering::SeqCst),
        1
    );
    assert_eq!(
        *fake.project_provider.subscription_modes.lock().await,
        vec![false, true]
    );
    let EventReplay::Events(events) = runtime
        .replay_project_events("commit-message-replay", &project_id, "", 0)
        .await
        .expect("replay project events")
    else {
        panic!("expected events replay")
    };
    assert!(events.is_empty());
}

#[tokio::test]
async fn temporary_project_should_be_created_once_from_configured_root() {
    let fake = FakePorts::new();
    let runtime = Arc::new(runtime_with_temporary_root(
        fake.clone(),
        Some(std::path::PathBuf::from("/workspace/temporary")),
    ));
    let project_id = ProjectId::try_from("temporary").expect("project id");
    let (left, right) = tokio::join!(
        runtime.list_agent_tasks("temp-left", &project_id, json!({})),
        runtime.list_agent_tasks("temp-right", &project_id, json!({}))
    );
    left.expect("left list");
    right.expect("right list");
    assert_eq!(fake.temporary_calls.load(Ordering::SeqCst), 1);
    assert_eq!(fake.for_project_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn task_attachment_should_fallback_to_provider_history_when_platform_store_misses() {
    let fake = FakePorts::new();
    let runtime = runtime(fake);
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let task_id = TaskId::try_from("task-1").expect("task id");

    let bytes = runtime
        .task_attachment(
            "history-attachment",
            &project_id,
            &task_id,
            "history-attachment",
        )
        .await
        .expect("historical attachment");

    assert_eq!(bytes.as_slice(), b"historical bytes");
}
