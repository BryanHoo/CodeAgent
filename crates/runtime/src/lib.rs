//! CodeAgent 宿主无关 Engine facade 与生命周期边界。

mod builder;
mod commit_message;
mod control;
mod effective_settings;
mod event_stream;
mod idempotency;
mod project_context;

use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use code_agent_core::{
    AttachmentPort, ClockPort, CodeAgentError, CodeAgentErrorCode, FilePort, GitPort,
    PortRequestContext, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_protocol::{
    AgentAttachment, AgentAttachmentKind, AgentBackgroundTerminalPage, AgentCapabilities,
    AgentGlobalSettings, AgentMcpServerPage, AgentModelPage, AgentProjectDefaults,
    AgentProviderConnectionRecord, AgentSkillPage, AgentTaskPage, AgentTaskSettings,
    GenerateCommitMessageRequest, GenerateCommitMessageResponse, Project, ProjectId, TaskId,
};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tokio::sync::OnceCell;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use uuid::Uuid;

use project_context::ProjectRuntimeContext;

use commit_message::{
    COMMIT_MESSAGE_CLEANUP_TIMEOUT, COMMIT_MESSAGE_TIMEOUT, build_commit_message_prompt,
    generation_error, read_generated_message, read_generation_settings, response, start_turn_input,
};

pub use builder::{CodeAgentRuntimeBuilder, RuntimeOptions};
pub use control::OperationRegistry;
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
                return Err(CodeAgentError::internal("project does not exist"));
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
            self.tasks.spawn(async move {
                loop {
                    tokio::select! {
                        _ = forwarding_cancellation.cancelled() => break,
                        event = events.recv() => {
                            let Some(event) = event else { break };
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
    ) -> Result<PortRequestContext, CodeAgentError> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::ShuttingDown,
                "runtime is shutting down",
                None,
            ));
        }
        self.operations.begin(request_id).await
    }

    /// 完成并释放活动操作。
    pub async fn finish_operation(&self, request_id: &str) {
        self.operations.finish(request_id).await;
    }

    /// 取消指定活动操作；不存在时幂等返回 `false`。
    pub async fn cancel_operation(&self, request_id: &str) -> bool {
        self.operations.cancel(request_id).await
    }

    /// 通过 Provider port 读取当前能力。
    pub async fn capabilities(
        &self,
        request_id: &str,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.provider.capabilities(&context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Provider 模型目录。
    pub async fn models(&self, request_id: &str) -> Result<AgentModelPage, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.provider.models(&context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Project Task 列表并惰性创建唯一 Runtime Context。
    pub async fn list_agent_tasks(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        input: Value,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.list_tasks(input, &operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 创建 Task。
    pub async fn start_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                self.idempotency
                    .execute("start-task", request_id, &input, || {
                        context.provider.start_task(input.clone(), &operation)
                    })
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Task Snapshot，并在返回前固定 Event Stream checkpoint。
    pub async fn read_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<Option<Value>, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => match context.provider.read_task(task_id, &operation).await? {
                Some(mut snapshot) => {
                    let task_id = TaskId::try_from(task_id)
                        .map_err(|error| CodeAgentError::internal(error.to_string()))?;
                    if let Some(settings) = self
                        .ports
                        .repository
                        .read_task_settings(project_id, &task_id, &operation)
                        .await?
                    {
                        // SQLite 是用户设置的事实来源，Provider Snapshot 只提供任务执行状态。
                        snapshot["settings"] = serde_json::to_value(settings)
                            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
                    }
                    let checkpoint = context.event_stream.checkpoint().await;
                    Ok(Some(json!({ "checkpoint": {
                        "sequence": checkpoint.sequence,
                        "sessionId": checkpoint.session_id.as_ref()
                    }, "snapshot": snapshot })))
                }
                None => Ok(None),
            },
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 启动 Task Turn。
    pub async fn start_agent_turn(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                self.idempotency
                    .execute("start-turn", request_id, &input, || {
                        context
                            .provider
                            .start_turn(task_id, input.clone(), &operation)
                    })
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// Steer 当前 Turn。
    pub async fn steer_agent_turn(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        turn_id: &str,
        input: Value,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => self
                .idempotency
                .execute("steer-turn", request_id, &input, || async {
                    context
                        .provider
                        .steer_turn(task_id, turn_id, input.clone(), &operation)
                        .await?;
                    Ok(Value::Null)
                })
                .await
                .map(|_| ()),
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 中断当前 Turn。
    pub async fn interrupt_agent_turn(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        turn_id: &str,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let payload = json!({ "taskId": task_id, "turnId": turn_id });
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => self
                .idempotency
                .execute("interrupt-turn", request_id, &payload, || async {
                    context
                        .provider
                        .interrupt_turn(task_id, turn_id, &operation)
                        .await?;
                    Ok(Value::Null)
                })
                .await
                .map(|_| ()),
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 启动代码评审 Turn。
    pub async fn start_agent_review(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        target: Value,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                context
                    .provider
                    .start_review(task_id, target, &operation)
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 解析待处理审批或用户输入请求。
    pub async fn resolve_agent_pending_request(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                self.idempotency
                    .execute("resolve-pending-request", request_id, &input, || {
                        context
                            .provider
                            .resolve_pending_request(input.clone(), &operation)
                    })
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Project Skills。
    pub async fn agent_skills(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.list_skills(&operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Task MCP Servers。
    pub async fn agent_mcp_servers(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.list_mcp_servers(task_id, &operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Task 后台终端。
    pub async fn agent_background_terminals(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                context
                    .provider
                    .list_background_terminals(task_id, &operation)
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 固定或取消固定 Task。
    pub async fn pin_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        pinned: bool,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.pin_task(task_id, pinned, &operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 重命名 Task。
    pub async fn rename_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        title: &str,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                context
                    .provider
                    .rename_task(task_id, title, &operation)
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 归档 Task。
    pub async fn archive_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.archive_task(task_id, &operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// Fork Task。
    pub async fn fork_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.fork_task(task_id, &operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 压缩 Task 上下文。
    pub async fn compact_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.compact_task(task_id, &operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 取消订阅 Task。
    pub async fn unsubscribe_agent_task(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<String, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.provider.unsubscribe_task(task_id, &operation).await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 重载 Task MCP Servers。
    pub async fn reload_agent_mcp_servers(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                context
                    .provider
                    .reload_mcp_servers(task_id, &operation)
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 终止 Task 后台终端。
    pub async fn terminate_agent_terminal(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        terminal_id: &str,
    ) -> Result<bool, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                context
                    .provider
                    .terminate_background_terminal(task_id, terminal_id, &operation)
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 上传 Task 反馈。
    pub async fn upload_agent_feedback(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &str,
        input: Value,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => {
                context
                    .provider
                    .upload_feedback(task_id, input, &operation)
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Provider 连接状态。
    pub async fn provider_connection_status(
        &self,
        request_id: &str,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = self.ports.provider.connection_status(&operation).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 启动官方 Provider 登录。
    pub async fn start_provider_login(&self, request_id: &str) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = self.ports.provider.start_official_login(&operation).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 取消 Provider 登录。
    pub async fn cancel_provider_login(
        &self,
        request_id: &str,
        login_id: &str,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = self.ports.provider.cancel_login(login_id, &operation).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 登出 Provider。
    pub async fn logout_provider(&self, request_id: &str) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = self.ports.provider.logout(&operation).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 配置自定义 Provider。
    pub async fn configure_custom_provider(
        &self,
        request_id: &str,
        input: Value,
    ) -> Result<Value, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .provider
            .configure_custom(input, &operation)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 固定当前 Project Event checkpoint。
    pub async fn project_event_checkpoint(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<EventCheckpoint, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => Ok(context.event_stream.checkpoint().await),
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
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
        let result = match self.project_context(project_id, &operation).await {
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
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 订阅 Project 实时事件。
    pub async fn subscribe_project_events(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<EventSubscription, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = match self.project_context(project_id, &operation).await {
            Ok(context) => context.event_stream.subscribe().await,
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 使用只读 ephemeral Task 为选定 Git 变更生成提交信息。
    pub async fn generate_commit_message(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        request: &GenerateCommitMessageRequest,
    ) -> Result<GenerateCommitMessageResponse, CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let result = async {
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
            let idempotency_payload = serde_json::to_value(request)
                .map_err(|error| CodeAgentError::internal(error.to_string()))?;
            let result = self
                .idempotency
                .execute(
                    "generate-commit-message",
                    request_id,
                    &idempotency_payload,
                    || async {
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
                    },
                )
                .await?;
            let message = result
                .as_str()
                .ok_or_else(|| generation_error("Cached commit message is invalid"))?
                .to_owned();
            response(message, request.expected_snapshot.as_str())
        }
        .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 释放 Project Context；关闭事件流后释放 Provider owner。
    pub async fn release_project_context(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<(), CodeAgentError> {
        let operation = self.begin_operation(request_id).await?;
        let cell = self.project_contexts.lock().await.remove(project_id);
        let result = if let Some(context) = cell.and_then(|cell| cell.get().cloned()) {
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
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 通过 Repository port 读取 Project。
    pub async fn read_project(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<Option<Value>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .read_project(project_id, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 返回全部已注册用户 Project。
    pub async fn list_projects(&self, request_id: &str) -> Result<Vec<Project>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.repository.list_projects(&context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 注册用户 Project。
    pub async fn register_project(
        &self,
        request_id: &str,
        root_path: &str,
        name: &str,
    ) -> Result<Project, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .register_project(root_path, name, self.ports.clock.now(), &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 原子替换全部用户 Project 顺序。
    pub async fn reorder_projects(
        &self,
        request_id: &str,
        project_ids: &[ProjectId],
    ) -> Result<Vec<Project>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .reorder_projects(project_ids, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 重命名用户 Project。
    pub async fn rename_project(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        name: &str,
    ) -> Result<Project, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .rename_project(project_id, name, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 删除用户 Project 本地注册信息及其受管附件。
    pub async fn remove_project(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<(), CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
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
                .release_project(project_id, &context)
                .await?;
        }
        let result = match self
            .ports
            .repository
            .remove_project(project_id, &context)
            .await
        {
            Ok(()) => {
                self.ports
                    .attachment
                    .release_project(project_id, &context)
                    .await
            }
            Err(error) => Err(error),
        };
        self.finish_operation(request_id).await;
        result
    }

    /// 读取持久化全局设置。
    pub async fn global_settings(
        &self,
        request_id: &str,
    ) -> Result<Option<AgentGlobalSettings>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.repository.read_global_settings(&context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 原子更新完整全局设置。
    pub async fn update_global_settings(
        &self,
        request_id: &str,
        settings: &AgentGlobalSettings,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .write_global_settings(settings, self.ports.clock.now(), &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Project 默认设置。
    pub async fn project_defaults(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<Option<AgentProjectDefaults>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .read_project_defaults(project_id, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 原子更新 Project 默认设置。
    pub async fn update_project_defaults(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        settings: &AgentProjectDefaults,
    ) -> Result<AgentProjectDefaults, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .write_project_defaults(project_id, settings, self.ports.clock.now(), &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Task 设置。
    pub async fn task_settings(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
    ) -> Result<Option<AgentTaskSettings>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .read_task_settings(project_id, task_id, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 原子更新 Task 设置。
    pub async fn update_task_settings(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
        settings: &AgentTaskSettings,
    ) -> Result<AgentTaskSettings, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .write_task_settings(
                project_id,
                task_id,
                settings,
                self.ports.clock.now(),
                &context,
            )
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Provider connection 持久化记录。
    pub async fn provider_connection_record(
        &self,
        request_id: &str,
    ) -> Result<Option<AgentProviderConnectionRecord>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .repository
            .read_provider_connection(&context)
            .await;
        self.finish_operation(request_id).await;
        result
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
        let result = self
            .ports
            .file
            .source_read(project_id, path, cursor, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Project 文件树。
    pub async fn file_tree(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        path: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.file.tree(project_id, path, &context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 搜索 Project 文件。
    pub async fn file_search(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &str,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.file.search(project_id, query, &context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 浏览宿主目录。
    pub async fn project_directories(
        &self,
        request_id: &str,
        path: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.file.browse_directories(path, &context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 浏览宿主可导入普通文件。
    pub async fn host_files(
        &self,
        request_id: &str,
        kind: &str,
        path: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .file
            .browse_host_files(kind, path, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 返回当前平台可用打开方式。
    pub async fn project_open_capabilities(
        &self,
        request_id: &str,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.file.open_capabilities(&context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 使用受控宿主应用打开 Project 路径。
    pub async fn open_project_path(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        app_id: &str,
        path: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .file
            .open_project_path(project_id, app_id, path, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 保存 raw IPC 上传的附件。
    pub async fn upload_attachment(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        kind: AgentAttachmentKind,
        media_type: &str,
        name: &str,
        bytes: Vec<u8>,
    ) -> Result<AgentAttachment, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .attachment
            .upload(project_id, kind, media_type, name, bytes, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 将宿主普通文件复制到附件受管目录。
    pub async fn import_host_attachment(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        kind: AgentAttachmentKind,
        path: &str,
    ) -> Result<AgentAttachment, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .attachment
            .import_host(project_id, kind, path, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取待提交 Project 附件字节。
    pub async fn pending_attachment(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        attachment_id: &str,
    ) -> Result<Vec<u8>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .attachment
            .read_pending(project_id, attachment_id, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取已绑定 Task 附件字节。
    pub async fn task_attachment(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
    ) -> Result<Vec<u8>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .attachment
            .read(project_id, task_id, attachment_id, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 使用系统默认应用打开已授权 Task 附件。
    pub async fn open_task_attachment(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
    ) -> Result<(), CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .attachment
            .open(project_id, task_id, attachment_id, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取受检 Project 图片字节。
    pub async fn project_image(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        path: &str,
    ) -> Result<Vec<u8>, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.file.read(project_id, path, &context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Git working tree 状态。
    pub async fn git_status(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        repository: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .git
            .status_for(project_id, repository, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取 Git 历史。
    pub async fn git_history(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &Value,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.git.history(project_id, query, &context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取提交文件列表。
    pub async fn git_commit_files(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &Value,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .git
            .commit_files(project_id, query, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 读取提交文件 diff。
    pub async fn git_commit_diff(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        query: &Value,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .git
            .commit_diff(project_id, query, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 切换 Git 分支。
    pub async fn git_switch_branch(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .git
            .switch_branch(project_id, branch, expected_snapshot, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 创建 Git 分支。
    pub async fn git_create_branch(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self
            .ports
            .git
            .create_branch(project_id, branch, expected_snapshot, &context)
            .await;
        self.finish_operation(request_id).await;
        result
    }

    /// 提交选定 Git 文件。
    pub async fn git_commit(
        &self,
        request_id: &str,
        project_id: &ProjectId,
        request: &Value,
    ) -> Result<Value, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.ports.git.commit(project_id, request, &context).await;
        self.finish_operation(request_id).await;
        result
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
        self.ports.repository.close().await
    }
}
