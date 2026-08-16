use std::{future::Future, sync::Arc};

use code_agent_core::CodeAgentError;
use code_agent_protocol::ProjectId;
use tokio::runtime::Handle;

use crate::{CodeAgentRuntime, event_subscription::drive_event_subscription};

impl CodeAgentRuntime {
    /// 启动由 Runtime 完整驱动的 Project 事件订阅。
    pub fn start_project_event_subscription<F, Fut>(
        self: &Arc<Self>,
        task_runtime: &Handle,
        request_id: String,
        project_id: ProjectId,
        session_id: String,
        after_sequence: u64,
        send: F,
    ) -> Result<String, CodeAgentError>
    where
        F: FnMut(Arc<[u8]>) -> Fut + Send + 'static,
        Fut: Future<Output = bool> + Send + 'static,
    {
        self.start_project_event_subscription_inner(
            task_runtime,
            request_id,
            project_id,
            None,
            session_id,
            after_sequence,
            send,
        )
    }

    /// 启动携带前端 Project Context lease 的事件订阅。
    #[expect(
        clippy::too_many_arguments,
        reason = "事件订阅边界需要显式传递恢复坐标与 Project lease"
    )]
    pub fn start_leased_project_event_subscription<F, Fut>(
        self: &Arc<Self>,
        task_runtime: &Handle,
        request_id: String,
        project_id: ProjectId,
        lease_id: String,
        session_id: String,
        after_sequence: u64,
        send: F,
    ) -> Result<String, CodeAgentError>
    where
        F: FnMut(Arc<[u8]>) -> Fut + Send + 'static,
        Fut: Future<Output = bool> + Send + 'static,
    {
        self.start_project_event_subscription_inner(
            task_runtime,
            request_id,
            project_id,
            Some(lease_id),
            session_id,
            after_sequence,
            send,
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "公共订阅入口在此统一组装受跟踪任务"
    )]
    fn start_project_event_subscription_inner<F, Fut>(
        self: &Arc<Self>,
        task_runtime: &Handle,
        request_id: String,
        project_id: ProjectId,
        lease_id: Option<String>,
        session_id: String,
        after_sequence: u64,
        send: F,
    ) -> Result<String, CodeAgentError>
    where
        F: FnMut(Arc<[u8]>) -> Fut + Send + 'static,
        Fut: Future<Output = bool> + Send + 'static,
    {
        let registration = self.event_subscriptions.register()?;
        let subscription_id = registration.id().to_owned();
        let runtime = Arc::downgrade(self);
        self.tasks.spawn_on(
            async move {
                let Some(runtime) = runtime.upgrade() else {
                    return;
                };
                let context = async {
                    let operation = runtime.begin_operation(&request_id).await?;
                    runtime
                        .project_context_with_lease(&project_id, &operation, lease_id.as_deref())
                        .await
                }
                .await;
                drop(runtime);
                if let Ok(context) = context {
                    let _ = drive_event_subscription(
                        Arc::clone(&context.event_stream),
                        &session_id,
                        after_sequence,
                        registration.cancellation().clone(),
                        send,
                    )
                    .await;
                }
            },
            task_runtime,
        );
        Ok(subscription_id)
    }

    /// 取消交付订阅；不存在时幂等返回 `false`。
    pub fn cancel_event_subscription(&self, subscription_id: &str) -> bool {
        self.event_subscriptions.cancel(subscription_id)
    }
}
