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
use code_agent_protocol::{AgentCapabilities, ProjectId};
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
    _attachment: Arc<dyn AttachmentPort>,
    _clock: Arc<dyn ClockPort>,
    _file: Arc<dyn FilePort>,
    _git: Arc<dyn GitPort>,
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
                _attachment: attachment,
                _clock: clock,
                _file: file,
                _git: git,
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
            })
    }
}
