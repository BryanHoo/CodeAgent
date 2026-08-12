use std::{marker::PhantomData, sync::Arc, time::Duration};

use code_agent_core::{
    AttachmentPort, ClockPort, FilePort, GitPort, ProviderPort, RepositoryPort, UpdatePort,
};

use crate::CodeAgentRuntime;

/// Runtime 有界容量与关闭等待配置。
#[derive(Clone, Copy, Debug)]
pub struct RuntimeOptions {
    /// 幂等成功结果和进行中请求的共享容量。
    pub idempotency_capacity: usize,
    /// 成功幂等结果的保留时间。
    pub idempotency_ttl: Duration,
    /// 同时活动操作的容量。
    pub operation_capacity: usize,
    /// 等待受跟踪任务关闭的上限。
    pub shutdown_timeout: Duration,
}

/// 尚未注入的 Builder 端口标记。
#[derive(Debug)]
pub struct Missing(PhantomData<()>);

/// 使用 type-state 强制注入全部必需端口的 Runtime Builder。
#[derive(Debug)]
pub struct CodeAgentRuntimeBuilder<
    R = Missing,
    P = Missing,
    G = Missing,
    F = Missing,
    A = Missing,
    C = Missing,
    U = Missing,
> {
    attachment: A,
    clock: C,
    file: F,
    git: G,
    options: RuntimeOptions,
    provider: P,
    repository: R,
    update: U,
}

impl CodeAgentRuntimeBuilder {
    /// 创建缺少全部必需端口的 Builder。
    #[must_use]
    pub fn new(options: RuntimeOptions) -> Self {
        Self {
            attachment: Missing(PhantomData),
            clock: Missing(PhantomData),
            file: Missing(PhantomData),
            git: Missing(PhantomData),
            options,
            provider: Missing(PhantomData),
            repository: Missing(PhantomData),
            update: Missing(PhantomData),
        }
    }
}

impl<P, G, F, A, C, U> CodeAgentRuntimeBuilder<Missing, P, G, F, A, C, U> {
    /// 注入 Repository 端口。
    pub fn repository(
        self,
        repository: Arc<dyn RepositoryPort>,
    ) -> CodeAgentRuntimeBuilder<Arc<dyn RepositoryPort>, P, G, F, A, C, U> {
        CodeAgentRuntimeBuilder {
            repository,
            provider: self.provider,
            git: self.git,
            file: self.file,
            attachment: self.attachment,
            clock: self.clock,
            update: self.update,
            options: self.options,
        }
    }
}

impl<R, G, F, A, C, U> CodeAgentRuntimeBuilder<R, Missing, G, F, A, C, U> {
    /// 注入 Provider 端口。
    pub fn provider(
        self,
        provider: Arc<dyn ProviderPort>,
    ) -> CodeAgentRuntimeBuilder<R, Arc<dyn ProviderPort>, G, F, A, C, U> {
        CodeAgentRuntimeBuilder {
            repository: self.repository,
            provider,
            git: self.git,
            file: self.file,
            attachment: self.attachment,
            clock: self.clock,
            update: self.update,
            options: self.options,
        }
    }
}

impl<R, P, F, A, C, U> CodeAgentRuntimeBuilder<R, P, Missing, F, A, C, U> {
    /// 注入 Git 端口。
    pub fn git(
        self,
        git: Arc<dyn GitPort>,
    ) -> CodeAgentRuntimeBuilder<R, P, Arc<dyn GitPort>, F, A, C, U> {
        CodeAgentRuntimeBuilder {
            repository: self.repository,
            provider: self.provider,
            git,
            file: self.file,
            attachment: self.attachment,
            clock: self.clock,
            update: self.update,
            options: self.options,
        }
    }
}

impl<R, P, G, A, C, U> CodeAgentRuntimeBuilder<R, P, G, Missing, A, C, U> {
    /// 注入 File 端口。
    pub fn file(
        self,
        file: Arc<dyn FilePort>,
    ) -> CodeAgentRuntimeBuilder<R, P, G, Arc<dyn FilePort>, A, C, U> {
        CodeAgentRuntimeBuilder {
            repository: self.repository,
            provider: self.provider,
            git: self.git,
            file,
            attachment: self.attachment,
            clock: self.clock,
            update: self.update,
            options: self.options,
        }
    }
}

impl<R, P, G, F, C, U> CodeAgentRuntimeBuilder<R, P, G, F, Missing, C, U> {
    /// 注入 Attachment 端口。
    pub fn attachment(
        self,
        attachment: Arc<dyn AttachmentPort>,
    ) -> CodeAgentRuntimeBuilder<R, P, G, F, Arc<dyn AttachmentPort>, C, U> {
        CodeAgentRuntimeBuilder {
            repository: self.repository,
            provider: self.provider,
            git: self.git,
            file: self.file,
            attachment,
            clock: self.clock,
            update: self.update,
            options: self.options,
        }
    }
}

impl<R, P, G, F, A, U> CodeAgentRuntimeBuilder<R, P, G, F, A, Missing, U> {
    /// 注入 Clock 端口。
    pub fn clock(
        self,
        clock: Arc<dyn ClockPort>,
    ) -> CodeAgentRuntimeBuilder<R, P, G, F, A, Arc<dyn ClockPort>, U> {
        CodeAgentRuntimeBuilder {
            repository: self.repository,
            provider: self.provider,
            git: self.git,
            file: self.file,
            attachment: self.attachment,
            clock,
            update: self.update,
            options: self.options,
        }
    }
}

impl<R, P, G, F, A, C> CodeAgentRuntimeBuilder<R, P, G, F, A, C, Missing> {
    /// 注入 Update 端口。
    pub fn update(
        self,
        update: Arc<dyn UpdatePort>,
    ) -> CodeAgentRuntimeBuilder<R, P, G, F, A, C, Arc<dyn UpdatePort>> {
        CodeAgentRuntimeBuilder {
            repository: self.repository,
            provider: self.provider,
            git: self.git,
            file: self.file,
            attachment: self.attachment,
            clock: self.clock,
            update,
            options: self.options,
        }
    }
}

impl
    CodeAgentRuntimeBuilder<
        Arc<dyn RepositoryPort>,
        Arc<dyn ProviderPort>,
        Arc<dyn GitPort>,
        Arc<dyn FilePort>,
        Arc<dyn AttachmentPort>,
        Arc<dyn ClockPort>,
        Arc<dyn UpdatePort>,
    >
{
    /// 构建具备全部必需端口的 Runtime。
    #[must_use]
    pub fn build(self) -> CodeAgentRuntime {
        CodeAgentRuntime::new(
            self.options,
            self.repository,
            self.provider,
            self.git,
            self.file,
            self.attachment,
            self.clock,
            self.update,
        )
    }
}
