//! CodeAgent 宿主无关 Engine facade 与生命周期边界。

mod builder;
mod commit_message;
mod control;
mod effective_settings;
mod event_stream;
mod idempotency;
mod project_context;
mod prompt;
mod provider_connection;
mod settings_validation;

use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use code_agent_core::{
    AgentMutationErrorCode, AttachmentPort, ClockPort, CodeAgentError, CodeAgentErrorCode,
    FilePort, GitPort, PortRequestContext, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_protocol::{
    AgentAttachment, AgentAttachmentKind, AgentBackgroundTerminalPage, AgentCapabilities,
    AgentGlobalSettings, AgentMcpServerPage, AgentModelPage, AgentProjectDefaults,
    AgentProviderConnectionRecord, AgentSkillPage, AgentTaskPage, AgentTaskSettings,
    GenerateCommitMessageRequest, GenerateCommitMessageResponse, Project, ProjectId, TaskId,
    ValueDefinition, parse_protocol_value,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tokio::sync::OnceCell;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use uuid::Uuid;

use project_context::ProjectRuntimeContext;
use prompt::resolve_prompt;

use commit_message::{
    COMMIT_MESSAGE_CLEANUP_TIMEOUT, COMMIT_MESSAGE_TIMEOUT, build_commit_message_prompt,
    generation_error, read_generated_message, read_generation_settings, response, start_turn_input,
};

pub use builder::{CodeAgentRuntimeBuilder, RuntimeOptions};
pub use control::{OperationGuard, OperationRegistry};
pub use event_stream::{
    AgentEventStream, DEFAULT_COALESCING_WINDOW, EventCheckpoint, EventReplay, EventStreamMetrics,
    EventStreamOptions, EventSubscription, PublishedEvent, SubscriberSignal,
};
pub use idempotency::IdempotencyRegistry;

struct RuntimePorts {
    attachment: Arc<dyn AttachmentPort>,
    clock: Arc<dyn ClockPort>,
    file: Arc<dyn FilePort>,
    git: Arc<dyn GitPort>,
    provider: Arc<dyn ProviderPort>,
    repository: Arc<dyn RepositoryPort>,
    _update: Arc<dyn UpdatePort>,
}

/// Runtime 附件上传边界的已解析输入。
#[derive(Debug)]
pub struct AttachmentUploadInput {
    pub bytes: Vec<u8>,
    pub kind: AgentAttachmentKind,
    pub media_type: String,
    pub name: String,
}

/// 管理全部宿主无关端口、操作和关闭树的 Runtime facade。
pub struct CodeAgentRuntime {
    accepting: AtomicBool,
    idempotency: IdempotencyRegistry,
    operations: OperationRegistry,
    options: RuntimeOptions,
    ports: RuntimePorts,
    project_contexts: Mutex<HashMap<ProjectId, Arc<OnceCell<Arc<ProjectRuntimeContext>>>>>,
    shutdown: CancellationToken,
    shutdown_lock: Mutex<()>,
    tasks: TaskTracker,
}

impl CodeAgentRuntime {
    #[expect(
        clippy::too_many_arguments,
        reason = "Builder 在编译期保证七个端口完整"
    )]
    fn new(
        options: RuntimeOptions,
        repository: Arc<dyn RepositoryPort>,
        provider: Arc<dyn ProviderPort>,
        git: Arc<dyn GitPort>,
        file: Arc<dyn FilePort>,
        attachment: Arc<dyn AttachmentPort>,
        clock: Arc<dyn ClockPort>,
        update: Arc<dyn UpdatePort>,
    ) -> Self {
        Self {
            accepting: AtomicBool::new(true),
            idempotency: IdempotencyRegistry::new(
                options.idempotency_capacity,
                options.idempotency_ttl,
            ),
            operations: OperationRegistry::new(options.operation_capacity),
            options,
            ports: RuntimePorts {
                attachment,
                clock,
                file,
                git,
                provider,
                repository,
                _update: update,
            },
            project_contexts: Mutex::new(HashMap::new()),
            shutdown: CancellationToken::new(),
            shutdown_lock: Mutex::new(()),
            tasks: TaskTracker::new(),
        }
    }

    /// 返回 Runtime 共享的幂等注册表。
    #[must_use]
    pub fn idempotency(&self) -> &IdempotencyRegistry {
        &self.idempotency
    }

    /// 启动受关闭树跟踪的后台任务。
    pub fn spawn_tracked<F, Fut>(&self, task: F)
    where
        F: FnOnce(CancellationToken) -> Fut,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.tasks.spawn(task(self.shutdown.child_token()));
    }

    async fn project_context(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Arc<ProjectRuntimeContext>, CodeAgentError> {
        let cell = {
            let mut contexts = self.project_contexts.lock().await;
            contexts
                .entry(project_id.clone())
                .or_insert_with(|| Arc::new(OnceCell::new()))
                .clone()
        };
        cell.get_or_try_init(|| async {
            let value = self
                .ports
                .repository
                .read_project(project_id, context)
                .await?;
            let value = if let Some(value) = value {
                value
            } else if project_id.as_str() == "temporary" {
                let root = self
                    .options
                    .temporary_project_root
                    .as_ref()
                    .ok_or_else(|| {
                        CodeAgentError::internal("temporary project root is not configured")
                    })?;
                let project = self
                    .ports
                    .repository
                    .ensure_temporary_project(
                        root.to_string_lossy().as_ref(),
                        self.ports.clock.now(),
                        context,
                    )
                    .await?;
                serde_json::to_value(project)
                    .map_err(|error| CodeAgentError::internal(error.to_string()))?
            } else {
                return Err(CodeAgentError::new(
                    CodeAgentErrorCode::NotFound,
                    "project was not found",
                    None,
                )
                .with_mutation_code(AgentMutationErrorCode::ProjectNotFound));
            };
            let project: Project = serde_json::from_value(value)
                .map_err(|error| CodeAgentError::internal(error.to_string()))?;
            let provider = self
                .ports
                .provider
                .for_project(project.clone(), context)
                .await?;
            let capabilities = self.ports.provider.capabilities(context).await?;
            let stream = Arc::new(AgentEventStream::new(EventStreamOptions {
                capacity: 1_000,
                max_event_bytes: 1_048_576,
                max_retained_bytes: 4 * 1_048_576,
                now: Arc::new(|| {
                    chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
                }),
                provider: Arc::from(capabilities.provider.as_str()),
                session_id: Arc::from(Uuid::new_v4().to_string()),
                subscriber_capacity: 256,
            })?);
            let cancellation = self.shutdown.child_token();
            let mut events = provider.subscribe_events(true, context).await?;
            let forwarding_stream = Arc::clone(&stream);
            let forwarding_cancellation = cancellation.clone();
            let forwarding_attachment = Arc::clone(&self.ports.attachment);
            let forwarding_project_id = project.id.clone();
            self.tasks.spawn(async move {
                loop {
                    tokio::select! {
                        _ = forwarding_cancellation.cancelled() => break,
                        event = events.recv() => {
                            let Some(event) = event else { break };
                            if event.event_type() == "provider.error"
                                && event.as_value()["payload"]["message"]
                                    == "Provider event subscription overflowed"
                            {
                                forwarding_stream.require_resync().await;
                                break;
                            }
                            if event.event_type() == "turn.completed"
                                && let Some(turn_id) = event.turn_id()
                            {
                                let cleanup = PortRequestContext::new(format!(
                                    "release-turn-{turn_id}"
                                ));
                                let _ = forwarding_attachment
                                    .release_turn(&forwarding_project_id, turn_id, &cleanup)
                                    .await;
                            }
                            forwarding_stream.publish(event).await;
                        }
                    }
                }
            });
            let flush_stream = Arc::clone(&stream);
            let flush_cancellation = cancellation.clone();
            self.tasks.spawn(async move {
                flush_stream.run_flush_loop(flush_cancellation).await;
            });
            Ok::<Arc<ProjectRuntimeContext>, CodeAgentError>(Arc::new(ProjectRuntimeContext::new(
                stream,
                provider,
                cancellation,
            )))
        })
        .await
        .cloned()
    }

    /// 注册一个可取消操作；关闭开始后拒绝新操作。
    pub async fn begin_operation(
        &self,
        request_id: &str,
    ) -> Result<OperationGuard<'_>, CodeAgentError> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::ShuttingDown,
                "runtime is shutting down",
                None,
            ));
        }
        self.operations.begin(request_id).await
    }

    /// 取消指定活动操作；不存在时幂等返回 `false`。
    pub async fn cancel_operation(&self, request_id: &str) -> bool {
        self.operations.cancel(request_id).await
    }

    /// 幂等键只负责结果复用；请求 ID 保留给活动操作追踪与协作取消。
    async fn run_idempotent<T, F, Fut>(
        &self,
        scope: &[&str],
        request_id: &str,
        idempotency_key: &str,
        payload: &Value,
        execute: F,
    ) -> Result<T, CodeAgentError>
    where
        T: DeserializeOwned + Serialize,
        F: FnOnce(PortRequestContext) -> Fut,
        Fut: Future<Output = Result<T, CodeAgentError>>,
    {
        let operation_identity = idempotency::operation_identity(scope, idempotency_key);
        self.idempotency
            .execute(scope, idempotency_key, payload, || async {
                let operation = self
                    .operations
                    .begin_scoped(&operation_identity, request_id)
                    .await?;
                execute((*operation).clone()).await
            })
            .await
    }

    /// 通过 Provider port 读取当前能力。
    pub async fn capabilities(
        &self,
        request_id: &str,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.provider.capabilities(&context).await
    }

    /// 读取 Provider 模型目录。
    pub async fn models(&self, request_id: &str) -> Result<AgentModelPage, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        if let Some(models) = self.persisted_models(&context).await? {
            return Ok(models);
        }
        self.ports.provider.models(&context).await
    }

    /// 读取 Project Task 列表并惰性创建唯一 Runtime Context。
    pub async fn list_agent_tasks(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        input: Value,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.list_tasks(input, &operation).await,
            Err(error) => Err(error),
        }
    }

    /// 创建 Task。
    pub async fn start_agent_task(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let payload = input.clone();
        self.run_idempotent(
            &["start-task", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context.provider.start_task(input, &operation).await
            },
        )
        .await
    }

    /// 读取 Task Snapshot，并在返回前固定 Event Stream checkpoint。
    pub async fn read_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<Option<Value>, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => match context.provider.read_task(task_id, &operation).await? {
                Some(mut snapshot) => {
                    let task_id = TaskId::try_from(task_id)
                        .map_err(|error| CodeAgentError::internal(error.to_string()))?;
                    let settings = self
                        .resolve_task_settings(project_id, &task_id, &operation)
                        .await?;
                    // Runtime 在公共协议出口组合执行态和有效设置。
                    snapshot["settings"] = serde_json::to_value(settings)
                        .map_err(|error| CodeAgentError::internal(error.to_string()))?;
                    let checkpoint = context.event_stream.checkpoint().await;
                    let response = json!({ "checkpoint": {
                        "sequence": checkpoint.sequence,
                        "sessionId": checkpoint.session_id.as_ref()
                    }, "snapshot": snapshot });
                    Ok(Some(
                        parse_protocol_value(ValueDefinition::AgentTaskSnapshotResponse, response)
                            .map_err(|error| CodeAgentError::internal(error.to_string()))?,
                    ))
                }
                None => Ok(None),
            },
            Err(error) => Err(error),
        }
    }

    /// 启动 Task Turn。
    pub async fn start_agent_turn(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let input = code_agent_protocol::parse_protocol_value(
            ValueDefinition::StartAgentTurnRequest,
            input,
        )
        .map_err(|error| {
            CodeAgentError::new(CodeAgentErrorCode::InvalidInput, error.to_string(), None)
        })?;
        let payload = input.clone();

        self.run_idempotent(
            &["start-turn", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                let prompt = resolve_prompt(
                    self.ports.attachment.as_ref(),
                    project_id,
                    &input["input"],
                    &operation,
                )
                .await?;
                let turn = context
                    .provider
                    .start_turn(
                        task_id,
                        json!({ "options": input["options"], "prompt": prompt.value }),
                        &operation,
                    )
                    .await?;
                let turn_id = turn["id"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| CodeAgentError::internal("Provider returned an invalid turn"))?;
                let task_id = TaskId::try_from(task_id)
                    .map_err(|_| CodeAgentError::internal("Task id is invalid"))?;
                self.ports
                    .attachment
                    .bind_to_turn(
                        project_id,
                        &task_id,
                        turn_id,
                        &prompt.attachment_ids,
                        &operation,
                    )
                    .await?;
                Ok(turn)
            },
        )
        .await
    }

    /// Steer 当前 Turn。
    pub async fn steer_agent_turn(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        turn_id: &str,
        input: Value,
    ) -> Result<(), CodeAgentError> {
        let input = code_agent_protocol::parse_protocol_value(
            ValueDefinition::SteerAgentTurnRequest,
            input,
        )
        .map_err(|error| {
            CodeAgentError::new(CodeAgentErrorCode::InvalidInput, error.to_string(), None)
        })?;
        let payload = input.clone();

        self.run_idempotent(
            &["steer-turn", project_id.as_str(), task_id, turn_id],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                let prompt = resolve_prompt(
                    self.ports.attachment.as_ref(),
                    project_id,
                    &input["input"],
                    &operation,
                )
                .await?;
                context
                    .provider
                    .steer_turn(
                        task_id,
                        turn_id,
                        json!({ "prompt": prompt.value }),
                        &operation,
                    )
                    .await?;
                let task_id = TaskId::try_from(task_id)
                    .map_err(|_| CodeAgentError::internal("Task id is invalid"))?;
                self.ports
                    .attachment
                    .bind_to_turn(
                        project_id,
                        &task_id,
                        turn_id,
                        &prompt.attachment_ids,
                        &operation,
                    )
                    .await?;
                Ok(Value::Null)
            },
        )
        .await
        .map(|_: Value| ())
    }

    /// 中断当前 Turn。
    pub async fn interrupt_agent_turn(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        turn_id: &str,
    ) -> Result<(), CodeAgentError> {
        let payload = json!({ "taskId": task_id, "turnId": turn_id });

        self.run_idempotent(
            &["interrupt-turn", project_id.as_str(), task_id, turn_id],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context
                    .provider
                    .interrupt_turn(task_id, turn_id, &operation)
                    .await?;
                Ok(Value::Null)
            },
        )
        .await
        .map(|_: Value| ())
    }

    /// 启动代码评审 Turn。
    pub async fn start_agent_review(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        target: Value,
    ) -> Result<Value, CodeAgentError> {
        let payload = target.clone();
        self.run_idempotent(
            &["review-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context
                    .provider
                    .start_review(task_id, target, &operation)
                    .await
            },
        )
        .await
    }

    /// 解析待处理审批或用户输入请求。
    pub async fn resolve_agent_pending_request(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let task_id = input["taskId"].as_str().unwrap_or_default().to_owned();
        let pending_request_id = input["requestId"].as_str().unwrap_or_default().to_owned();
        let payload = input.clone();
        self.run_idempotent(
            &[
                "resolve-pending-request",
                project_id.as_str(),
                &task_id,
                &pending_request_id,
            ],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context
                    .provider
                    .resolve_pending_request(input, &operation)
                    .await
            },
        )
        .await
    }

    /// 读取 Project Skills。
    pub async fn agent_skills(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.list_skills(&operation).await,
            Err(error) => Err(error),
        }
    }

    /// 读取 Task MCP Servers。
    pub async fn agent_mcp_servers(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.list_mcp_servers(task_id, &operation).await,
            Err(error) => Err(error),
        }
    }

    /// 读取 Task 后台终端。
    pub async fn agent_background_terminals(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => {
                context
                    .provider
                    .list_background_terminals(task_id, &operation)
                    .await
            }
            Err(error) => Err(error),
        }
    }

    /// 固定或取消固定 Task。
    pub async fn pin_agent_task(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        pinned: bool,
    ) -> Result<Value, CodeAgentError> {
        let payload = json!({ "pinned": pinned });
        self.run_idempotent(
            &["pin-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context.provider.pin_task(task_id, pinned, &operation).await
            },
        )
        .await
    }

    /// 重命名 Task。
    pub async fn rename_agent_task(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        title: &str,
    ) -> Result<(), CodeAgentError> {
        let payload = json!({ "title": title });
        self.run_idempotent(
            &["rename-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context
                    .provider
                    .rename_task(task_id, title, &operation)
                    .await
            },
        )
        .await
    }

    /// 归档 Task。
    pub async fn archive_agent_task(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<(), CodeAgentError> {
        self.run_idempotent(
            &["archive-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context.provider.archive_task(task_id, &operation).await
            },
        )
        .await
    }

    /// Fork Task。
    pub async fn fork_agent_task(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<Value, CodeAgentError> {
        self.run_idempotent(
            &["fork-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context.provider.fork_task(task_id, &operation).await
            },
        )
        .await
    }

    /// 压缩 Task 上下文。
    pub async fn compact_agent_task(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<(), CodeAgentError> {
        self.run_idempotent(
            &["compact-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context.provider.compact_task(task_id, &operation).await
            },
        )
        .await
    }

    /// 取消订阅 Task。
    pub async fn unsubscribe_agent_task(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<String, CodeAgentError> {
        self.run_idempotent(
            &["unsubscribe-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context.provider.unsubscribe_task(task_id, &operation).await
            },
        )
        .await
    }

    /// 重载 Task MCP Servers。
    pub async fn reload_agent_mcp_servers(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.run_idempotent(
            &["reload-task-mcp-servers", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context
                    .provider
                    .reload_mcp_servers(task_id, &operation)
                    .await
            },
        )
        .await
    }

    /// 终止 Task 后台终端。
    pub async fn terminate_agent_terminal(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        terminal_id: &str,
    ) -> Result<bool, CodeAgentError> {
        self.run_idempotent(
            &[
                "terminate-background-terminal",
                project_id.as_str(),
                task_id,
                terminal_id,
            ],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context
                    .provider
                    .terminate_background_terminal(task_id, terminal_id, &operation)
                    .await
            },
        )
        .await
    }

    /// 上传 Task 反馈。
    pub async fn upload_agent_feedback(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &str,
        input: Value,
    ) -> Result<(), CodeAgentError> {
        let payload = input.clone();
        self.run_idempotent(
            &["feedback-task", project_id.as_str(), task_id],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let context = self.project_context(project_id, &operation).await?;
                context
                    .provider
                    .upload_feedback(task_id, input, &operation)
                    .await
            },
        )
        .await
    }

    /// 读取 Provider 连接状态。
    pub async fn provider_connection_status(
        &self,
        request_id: &str,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        self.ports.provider.connection_status(&operation).await
    }

    /// 启动官方 Provider 登录。
    pub async fn start_provider_login(
        &self,
        request_id: &str,
        idempotency_key: &str,
    ) -> Result<Value, CodeAgentError> {
        self.run_idempotent(
            &["start-official-provider-login"],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                let response = self.ports.provider.start_official_login(&operation).await?;
                let record = provider_connection::official_record(self.ports.clock.now())?;
                self.ports
                    .repository
                    .write_provider_connection(&record, &operation)
                    .await?;
                Ok(response)
            },
        )
        .await
    }

    /// 取消 Provider 登录。
    pub async fn cancel_provider_login(
        &self,
        request_id: &str,
        idempotency_key: &str,
        login_id: &str,
    ) -> Result<Value, CodeAgentError> {
        self.run_idempotent(
            &["cancel-provider-login", login_id],
            request_id,
            idempotency_key,
            &json!({ "loginId": login_id }),
            |operation| async move { self.ports.provider.cancel_login(login_id, &operation).await },
        )
        .await
    }

    /// 登出 Provider。
    pub async fn logout_provider(
        &self,
        request_id: &str,
        idempotency_key: &str,
    ) -> Result<Value, CodeAgentError> {
        self.run_idempotent(
            &["logout-provider"],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move { self.ports.provider.logout(&operation).await },
        )
        .await
    }

    /// 配置自定义 Provider。
    pub async fn configure_custom_provider(
        &self,
        request_id: &str,
        idempotency_key: &str,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let payload = input.clone();
        self.run_idempotent(
            &["configure-custom-provider"],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                let response = self
                    .ports
                    .provider
                    .configure_custom(input, &operation)
                    .await?;
                let record = provider_connection::custom_record(&response, self.ports.clock.now())?;
                self.ports
                    .repository
                    .write_provider_connection(&record, &operation)
                    .await?;
                Ok(response)
            },
        )
        .await
    }

    /// 固定当前 Project Event checkpoint。
    pub async fn project_event_checkpoint(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<EventCheckpoint, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => Ok(context.event_stream.checkpoint().await),
            Err(error) => Err(error),
        }
    }

    /// 回放 Project Event；空 session 使用当前 session，供首次连接发送 ready。
    pub async fn replay_project_events(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        session_id: &str,
        sequence: u64,
    ) -> Result<EventReplay, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => {
                let current = context.event_stream.checkpoint().await;
                let session_id = if session_id.is_empty() {
                    current.session_id.as_ref()
                } else {
                    session_id
                };
                Ok(context
                    .event_stream
                    .replay_after(session_id, sequence)
                    .await)
            }
            Err(error) => Err(error),
        }
    }

    /// 订阅 Project 实时事件。
    pub async fn subscribe_project_events(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<EventSubscription, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;

        match self.project_context(project_id, &operation).await {
            Ok(context) => context.event_stream.subscribe().await,
            Err(error) => Err(error),
        }
    }

    /// 读取所有已初始化 Project 的 Event Stream 指标快照。
    pub async fn event_stream_metrics(
        &self,
        request_id: &str,
    ) -> Result<Vec<(ProjectId, EventStreamMetrics)>, CodeAgentError> {
        let _operation = self.begin_operation(request_id).await?;
        // 仅在 Map 锁内复制上下文，避免逐个读取指标时阻塞 Project 生命周期操作。
        let contexts = self
            .project_contexts
            .lock()
            .await
            .iter()
            .filter_map(|(project_id, cell)| {
                cell.get()
                    .cloned()
                    .map(|context| (project_id.clone(), context))
            })
            .collect::<Vec<_>>();
        let mut metrics = Vec::with_capacity(contexts.len());
        for (project_id, context) in contexts {
            metrics.push((project_id, context.event_stream.metrics().await));
        }
        metrics.sort_unstable_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
        Ok(metrics)
    }

    /// 使用只读 ephemeral Task 为选定 Git 变更生成提交信息。
    pub async fn generate_commit_message(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        request: &GenerateCommitMessageRequest,
    ) -> Result<GenerateCommitMessageResponse, CodeAgentError> {
        let payload = serde_json::to_value(request)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        self.run_idempotent(
            &["generate-commit-message", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
            let runtime_context = self.project_context(project_id, &operation).await?;
            let status = self
                .ports
                .git
                .status_for(
                    project_id,
                    request.repository.as_deref().map(String::as_str),
                    &operation,
                )
                .await?;
            let stored = self
                .ports
                .repository
                .read_global_settings(&operation)
                .await?;
            let (defaults, models) = if stored.is_some() {
                (Value::Null, None)
            } else {
                (
                    self.ports.provider.default_settings(&operation).await?,
                    Some(self.ports.provider.models(&operation).await?),
                )
            };
            let empty_models = serde_json::from_value(json!({ "data": [], "nextCursor": null }))
                .map_err(|error| CodeAgentError::internal(error.to_string()))?;
            let settings = read_generation_settings(
                stored.as_ref(),
                &defaults,
                models.as_ref().unwrap_or(&empty_models),
            )?;
            let prompt = build_commit_message_prompt(&status, request, &settings.custom_prompt)?;
            let result = async {
                    let mut subscription = runtime_context.event_stream.subscribe().await?;
                    let task = runtime_context
                        .provider
                        .start_task(json!({ "ephemeral": true }), &operation)
                        .await?;
                    let task_id = task["id"]
                        .as_str()
                        .filter(|task_id| !task_id.is_empty())
                        .ok_or_else(|| generation_error("Codex returned an invalid task"))?
                        .to_owned();
                    let mut turn_id = None;
                    let mut turn_finished = false;
                    let generated = async {
                        let started = runtime_context
                            .provider
                            .start_turn(&task_id, start_turn_input(prompt, &settings), &operation)
                            .await?;
                        turn_id = started["id"].as_str().map(str::to_owned);
                        if started["status"] != "running" {
                            turn_finished = true;
                            return read_generated_message(&started, None);
                        }

                        let mut completed_messages = HashMap::<String, String>::new();
                        loop {
                            tokio::select! {
                                _ = operation.cancelled() => {
                                    return Err(CodeAgentError::new(CodeAgentErrorCode::Cancelled, "commit message generation was cancelled", None));
                                }
                                signal = subscription.signal.changed() => {
                                    if signal.is_err() || *subscription.signal.borrow() == SubscriberSignal::ResyncRequired {
                                        return Err(generation_error("Commit message event subscription fell behind"));
                                    }
                                }
                                event = subscription.events.recv() => {
                                    let event = event.ok_or_else(|| generation_error("Commit message event subscription closed"))?;
                                    let value = event.value();
                                    if value["taskId"] != task_id {
                                        continue;
                                    }
                                    match value["type"].as_str() {
                                        Some("item.completed") if value["payload"]["item"]["type"] == "message" && value["payload"]["item"]["role"] == "assistant" => {
                                            if let (Some(id), Some(text)) = (value["turnId"].as_str(), value["payload"]["item"]["text"].as_str()) {
                                                completed_messages.insert(id.to_owned(), text.to_owned());
                                            }
                                        }
                                        Some("turn.completed") => {
                                            turn_finished = true;
                                            let turn = &value["payload"]["turn"];
                                            let text = turn["id"].as_str().and_then(|id| completed_messages.get(id)).map(String::as_str);
                                            return read_generated_message(turn, text);
                                        }
                                        Some("provider.error") if value["payload"]["willRetry"] == Value::Bool(false) => {
                                            return Err(generation_error(value["payload"]["message"].as_str().unwrap_or("Codex could not generate a commit message")));
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                    };
                    let generated = tokio::time::timeout(COMMIT_MESSAGE_TIMEOUT, generated)
                        .await
                        .map_err(|_| generation_error("Commit message generation timed out"))
                        .and_then(|result| result);

                    // 清理不能无限等待，也不能覆盖生成阶段的原始错误。
                    if !turn_finished
                        && let Some(turn_id) = turn_id.as_deref()
                    {
                        let _ = tokio::time::timeout(
                            COMMIT_MESSAGE_CLEANUP_TIMEOUT,
                            runtime_context.provider.interrupt_turn(
                                &task_id,
                                turn_id,
                                &operation,
                            ),
                        )
                        .await;
                    }
                    let _ = tokio::time::timeout(
                        COMMIT_MESSAGE_CLEANUP_TIMEOUT,
                        runtime_context
                            .provider
                            .unsubscribe_task(&task_id, &operation),
                    )
                    .await;
                    generated.map(Value::String)
                }
                .await?;
            let message = result
                .as_str()
                .ok_or_else(|| generation_error("Cached commit message is invalid"))?
                .to_owned();
            response(message, request.expected_snapshot.as_str())
            },
        )
        .await
    }

    /// 释放 Project Context；关闭事件流后释放 Provider owner。
    pub async fn release_project_context(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let cell = self.project_contexts.lock().await.remove(project_id);

        self.ports
            .file
            .release_project(project_id, &operation)
            .await?;

        if let Some(context) = cell.and_then(|cell| cell.get().cloned()) {
            context.close().await?;
            self.ports
                .provider
                .release_project(project_id, &operation)
                .await
        } else {
            self.ports
                .provider
                .release_project(project_id, &operation)
                .await
        }
    }

    /// 通过 Repository port 读取 Project。
    pub async fn read_project(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<Option<Value>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .repository
            .read_project(project_id, &context)
            .await
    }

    /// 返回全部已注册用户 Project。
    pub async fn list_projects(&self, request_id: &str) -> Result<Vec<Project>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.repository.list_projects(&context).await
    }

    /// 注册用户 Project。
    pub async fn register_project(
        &self,
        request_id: &str,
        idempotency_key: &str,
        root_path: &str,
        name: &str,
    ) -> Result<Project, CodeAgentError> {
        let payload = json!({ "name": name, "rootPath": root_path });
        self.run_idempotent(
            &["add-project"],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .repository
                    .register_project(root_path, name, self.ports.clock.now(), &operation)
                    .await
            },
        )
        .await
    }

    /// 原子替换全部用户 Project 顺序。
    pub async fn reorder_projects(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_ids: &[ProjectId],
    ) -> Result<Vec<Project>, CodeAgentError> {
        let payload = serde_json::to_value(project_ids)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        self.run_idempotent(
            &["reorder-projects"],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .repository
                    .reorder_projects(project_ids, &operation)
                    .await
            },
        )
        .await
    }

    /// 重命名用户 Project。
    pub async fn rename_project(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        name: &str,
    ) -> Result<Project, CodeAgentError> {
        let payload = json!({ "name": name });
        self.run_idempotent(
            &["rename-project", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .repository
                    .rename_project(project_id, name, &operation)
                    .await
            },
        )
        .await
    }

    /// 删除用户 Project 本地注册信息及其受管附件。
    pub async fn remove_project(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
    ) -> Result<(), CodeAgentError> {
        self.run_idempotent(
            &["remove-project", project_id.as_str()],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                if let Some(runtime_context) = self
                    .project_contexts
                    .lock()
                    .await
                    .remove(project_id)
                    .and_then(|cell| cell.get().cloned())
                {
                    runtime_context.close().await?;
                    self.ports
                        .provider
                        .release_project(project_id, &operation)
                        .await?;
                }
                self.ports
                    .repository
                    .remove_project(project_id, &operation)
                    .await?;
                self.ports
                    .file
                    .release_project(project_id, &operation)
                    .await?;
                self.ports
                    .attachment
                    .release_project(project_id, &operation)
                    .await
            },
        )
        .await
    }

    /// 读取持久化全局设置。
    pub async fn global_settings(
        &self,
        request_id: &str,
    ) -> Result<Option<AgentGlobalSettings>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.repository.read_global_settings(&context).await
    }

    /// 原子更新完整全局设置。
    pub async fn update_global_settings(
        &self,
        request_id: &str,
        idempotency_key: &str,
        settings: &AgentGlobalSettings,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        let payload = serde_json::to_value(settings)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let validation_payload = payload.clone();
        self.run_idempotent(
            &["update-global-settings"],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.validate_settings_model(&validation_payload, &operation)
                    .await?;
                self.ports
                    .repository
                    .write_global_settings(settings, self.ports.clock.now(), &operation)
                    .await
            },
        )
        .await
    }

    /// 读取 Project 默认设置。
    pub async fn project_defaults(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<Option<AgentProjectDefaults>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .repository
            .read_project_defaults(project_id, &context)
            .await
    }

    /// 原子更新 Project 默认设置。
    pub async fn update_project_defaults(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        settings: &AgentProjectDefaults,
    ) -> Result<AgentProjectDefaults, CodeAgentError> {
        let payload = serde_json::to_value(settings)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let validation_payload = payload.clone();
        self.run_idempotent(
            &["update-project-defaults", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ensure_project_exists(project_id, &operation).await?;
                self.validate_settings_model(&validation_payload, &operation)
                    .await?;
                self.ports
                    .repository
                    .write_project_defaults(
                        project_id,
                        settings,
                        self.ports.clock.now(),
                        &operation,
                    )
                    .await
            },
        )
        .await
    }

    /// 读取 Task 有效设置。
    pub async fn task_settings(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
    ) -> Result<AgentTaskSettings, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.resolve_task_settings(project_id, task_id, &context)
            .await
    }

    /// 原子更新 Task 设置。
    pub async fn update_task_settings(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
        settings: &AgentTaskSettings,
    ) -> Result<AgentTaskSettings, CodeAgentError> {
        let payload = serde_json::to_value(settings)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        self.run_idempotent(
            &[
                "update-task-settings",
                project_id.as_str(),
                task_id.as_str(),
            ],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ensure_task_belongs_to_project(project_id, task_id, &operation)
                    .await?;
                let settings = self
                    .validated_task_settings(project_id, settings, &operation)
                    .await?;
                self.ports
                    .repository
                    .write_task_settings(
                        project_id,
                        task_id,
                        &settings,
                        self.ports.clock.now(),
                        &operation,
                    )
                    .await
            },
        )
        .await
    }

    /// 读取 Provider connection 持久化记录。
    pub async fn provider_connection_record(
        &self,
        request_id: &str,
    ) -> Result<Option<AgentProviderConnectionRecord>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .repository
            .read_provider_connection(&context)
            .await
    }

    /// 读取 Project 源文件分页。
    pub async fn source_file(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        path: &str,
        cursor: u64,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .file
            .source_read(project_id, path, cursor, &context)
            .await
    }

    /// 读取 Project 文件树。
    pub async fn file_tree(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        path: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.file.tree(project_id, path, &context).await
    }

    /// 搜索 Project 文件。
    pub async fn file_search(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &str,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.file.search(project_id, query, &context).await
    }

    /// 浏览宿主目录。
    pub async fn project_directories(
        &self,
        request_id: &str,
        path: Option<&str>,
        show_hidden: bool,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .file
            .browse_directories(path, show_hidden, &context)
            .await
    }

    /// 浏览宿主可导入普通文件。
    pub async fn host_files(
        &self,
        request_id: &str,
        kind: &str,
        path: Option<&str>,
        show_hidden: bool,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .file
            .browse_host_files(kind, path, show_hidden, &context)
            .await
    }

    /// 返回当前平台可用打开方式。
    pub async fn project_open_capabilities(
        &self,
        request_id: &str,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.file.open_capabilities(&context).await
    }

    /// 使用受控宿主应用打开 Project 路径。
    pub async fn open_project_path(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        app_id: &str,
        path: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let payload = json!({ "appId": app_id, "path": path });
        self.run_idempotent(
            &["open-project", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .file
                    .open_project_path(project_id, app_id, path, &operation)
                    .await
            },
        )
        .await
    }

    /// 保存 raw IPC 上传的附件。
    pub async fn upload_attachment(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        input: AttachmentUploadInput,
    ) -> Result<AgentAttachment, CodeAgentError> {
        let AttachmentUploadInput {
            bytes,
            kind,
            media_type,
            name,
        } = input;
        let content_hash = format!("{:x}", Sha256::digest(&bytes));
        let payload = json!({
            "contentHash": content_hash,
            "kind": kind,
            "mediaType": media_type.as_str(),
            "name": name.as_str(),
            "size": bytes.len(),
        });
        self.run_idempotent(
            &["upload-attachment", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .attachment
                    .upload(project_id, kind, &media_type, &name, bytes, &operation)
                    .await
            },
        )
        .await
    }

    /// 将宿主普通文件复制到附件受管目录。
    pub async fn import_host_attachment(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        kind: AgentAttachmentKind,
        path: &str,
    ) -> Result<AgentAttachment, CodeAgentError> {
        let payload = json!({ "kind": kind, "path": path });
        self.run_idempotent(
            &["import-host-attachment", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .attachment
                    .import_host(project_id, kind, path, &operation)
                    .await
            },
        )
        .await
    }

    /// 读取待提交 Project 附件字节。
    pub async fn pending_attachment(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        attachment_id: &str,
    ) -> Result<Vec<u8>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .attachment
            .read_pending(project_id, attachment_id, &context)
            .await
    }

    /// 读取已绑定 Task 附件字节。
    pub async fn task_attachment(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
    ) -> Result<code_agent_core::AttachmentBytes, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let platform_result = self
            .ports
            .attachment
            .read(project_id, task_id, attachment_id, &context)
            .await;

        match platform_result {
            Ok(bytes) => Ok(bytes.into()),
            Err(error) if error.code() == CodeAgentErrorCode::NotFound => {
                // 历史附件由 Provider 授权；仅平台 Store 明确未命中时才进入该读取路径。
                match self.project_context(project_id, &context).await {
                    Ok(project) => match project
                        .provider
                        .read_task_attachment(task_id.as_str(), attachment_id, &context)
                        .await
                    {
                        Ok(Some(bytes)) => Ok(bytes),
                        Ok(None) => Err(error),
                        Err(provider_error) => Err(provider_error),
                    },
                    Err(context_error) => Err(context_error),
                }
            }
            Err(error) => Err(error),
        }
    }

    /// 使用系统默认应用打开已授权 Task 附件。
    pub async fn open_task_attachment(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
    ) -> Result<(), CodeAgentError> {
        self.run_idempotent(
            &[
                "open-task-attachment",
                project_id.as_str(),
                task_id.as_str(),
                attachment_id,
            ],
            request_id,
            idempotency_key,
            &json!({}),
            |operation| async move {
                self.ports
                    .attachment
                    .open(project_id, task_id, attachment_id, &operation)
                    .await
            },
        )
        .await
    }

    /// 读取受检 Project 图片字节。
    pub async fn project_image(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        path: &str,
    ) -> Result<Vec<u8>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.file.read(project_id, path, &context).await
    }

    /// 读取 Git working tree 状态。
    pub async fn git_status(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        repository: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .git
            .status_for(project_id, repository, &context)
            .await
    }

    /// 读取 Git 历史。
    pub async fn git_history(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &Value,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports.git.history(project_id, query, &context).await
    }

    /// 读取提交文件列表。
    pub async fn git_commit_files(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &Value,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .git
            .commit_files(project_id, query, &context)
            .await
    }

    /// 读取提交文件 diff。
    pub async fn git_commit_diff(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &Value,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;

        self.ports
            .git
            .commit_diff(project_id, query, &context)
            .await
    }

    /// 切换 Git 分支。
    pub async fn git_switch_branch(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
    ) -> Result<Value, CodeAgentError> {
        let payload = json!({ "branch": branch, "expectedSnapshot": expected_snapshot });
        self.run_idempotent(
            &["switch-project-branch", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .git
                    .switch_branch(project_id, branch, expected_snapshot, &operation)
                    .await
            },
        )
        .await
    }

    /// 创建 Git 分支。
    pub async fn git_create_branch(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
    ) -> Result<Value, CodeAgentError> {
        let payload = json!({ "branch": branch, "expectedSnapshot": expected_snapshot });
        self.run_idempotent(
            &["create-project-branch", project_id.as_str()],
            request_id,
            idempotency_key,
            &payload,
            |operation| async move {
                self.ports
                    .git
                    .create_branch(project_id, branch, expected_snapshot, &operation)
                    .await
            },
        )
        .await
    }

    /// 提交选定 Git 文件。
    pub async fn git_commit(
        &self,
        request_id: &str,
        idempotency_key: &str,
        project_id: &ProjectId,
        request: &Value,
    ) -> Result<Value, CodeAgentError> {
        self.run_idempotent(
            &["commit-project-changes", project_id.as_str()],
            request_id,
            idempotency_key,
            request,
            |operation| async move { self.ports.git.commit(project_id, request, &operation).await },
        )
        .await
    }

    /// 停止接收、通知取消并有界等待所有受跟踪任务。
    pub async fn shutdown(&self) -> Result<(), CodeAgentError> {
        let _guard = self.shutdown_lock.lock().await;
        if !self.accepting.swap(false, Ordering::AcqRel) && self.tasks.is_closed() {
            return Ok(());
        }
        // 注册表在同一临界区内停止接收并取消活动项，避免关闭竞态。
        self.operations.close().await;
        self.idempotency.close().await;
        let project_contexts = {
            let mut contexts = self.project_contexts.lock().await;
            contexts
                .drain()
                .filter_map(|(project_id, cell)| {
                    cell.get().cloned().map(|context| (project_id, context))
                })
                .collect::<Vec<_>>()
        };
        let shutdown_context = PortRequestContext::new("runtime-shutdown");
        for (project_id, context) in project_contexts {
            context.close().await?;
            self.ports
                .provider
                .release_project(&project_id, &shutdown_context)
                .await?;
        }
        self.shutdown.cancel();
        self.tasks.close();
        tokio::time::timeout(self.options.shutdown_timeout, self.tasks.wait())
            .await
            .map_err(|_| {
                CodeAgentError::new(
                    CodeAgentErrorCode::Timeout,
                    "runtime shutdown timed out",
                    None,
                )
            })?;
        self.ports.file.close().await?;
        self.ports.repository.close().await
    }
}
