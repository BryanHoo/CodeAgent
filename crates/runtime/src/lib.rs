//! CodeAgent 宿主无关 Engine facade 与生命周期边界。

mod builder;
mod control;
mod event_stream;
mod idempotency;

use std::{
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
    AgentAttachment, AgentAttachmentKind, AgentCapabilities, AgentGlobalSettings,
    AgentProjectDefaults, AgentProviderConnectionRecord, AgentTaskSettings, Project, ProjectId,
    TaskId,
};
use serde_json::Value;
use tokio::sync::Mutex;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

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
