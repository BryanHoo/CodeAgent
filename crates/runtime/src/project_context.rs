use std::{
    collections::{HashMap, HashSet},
    future::Future,
    ops::Deref,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use code_agent_core::{CodeAgentError, ProjectProviderPort};
use code_agent_protocol::ProjectId;
use tokio::sync::{Mutex, Notify};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use crate::AgentEventStream;

/// Runtime 内单个 Project 的 Provider 与事件流生命周期。
pub(crate) struct ProjectRuntimeContext {
    pub event_stream: Arc<AgentEventStream>,
    pub provider: Arc<dyn ProjectProviderPort>,
    shutdown: CancellationToken,
    tasks: TaskTracker,
}

impl ProjectRuntimeContext {
    pub(crate) fn new(
        event_stream: Arc<AgentEventStream>,
        provider: Arc<dyn ProjectProviderPort>,
        shutdown: CancellationToken,
        tasks: TaskTracker,
    ) -> Self {
        Self {
            event_stream,
            provider,
            shutdown,
            tasks,
        }
    }

    /// 先停止 Provider 转发，再冲刷并关闭事件流。
    pub(crate) async fn close(&self) -> Result<(), CodeAgentError> {
        self.shutdown.cancel();
        self.tasks.close();
        self.tasks.wait().await;
        self.event_stream.close().await;
        Ok(())
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum ProjectContextPhase {
    Active,
    Released,
    Releasing,
}

struct ProjectContextState {
    context: Option<Arc<ProjectRuntimeContext>>,
    leases: HashSet<String>,
    phase: ProjectContextPhase,
}

/// 单个 Project 的初始化、活动引用与释放屏障。
pub(crate) struct ProjectContextSlot {
    active_handles: AtomicUsize,
    active_handles_changed: Notify,
    lifecycle_changed: Notify,
    state: Mutex<ProjectContextState>,
}

impl ProjectContextSlot {
    fn new() -> Self {
        Self {
            active_handles: AtomicUsize::new(0),
            active_handles_changed: Notify::new(),
            lifecycle_changed: Notify::new(),
            state: Mutex::new(ProjectContextState {
                context: None,
                leases: HashSet::new(),
                phase: ProjectContextPhase::Active,
            }),
        }
    }

    pub(crate) async fn acquire<F>(
        self: &Arc<Self>,
        lease_id: Option<&str>,
        initialize: F,
    ) -> Result<Option<ProjectContextHandle>, CodeAgentError>
    where
        F: Future<Output = Result<Arc<ProjectRuntimeContext>, CodeAgentError>>,
    {
        let mut state = self.state.lock().await;
        if state.phase != ProjectContextPhase::Active {
            return Ok(None);
        }
        if state.context.is_none() {
            state.context = Some(initialize.await?);
        }
        if let Some(lease_id) = lease_id {
            state.leases.insert(lease_id.to_owned());
        }
        let context =
            state.context.as_ref().cloned().ok_or_else(|| {
                CodeAgentError::internal("project context initialization was lost")
            })?;
        self.active_handles.fetch_add(1, Ordering::AcqRel);
        Ok(Some(ProjectContextHandle {
            context,
            slot: Arc::clone(self),
        }))
    }

    async fn begin_release(self: &Arc<Self>, lease_id: Option<&str>) -> ProjectContextRelease {
        let mut state = self.state.lock().await;
        if state.phase != ProjectContextPhase::Active {
            return ProjectContextRelease::Ignored;
        }
        let wait_for_handles = lease_id.is_some();
        if let Some(lease_id) = lease_id {
            if !state.leases.remove(lease_id) {
                return ProjectContextRelease::Ignored;
            }
            if !state.leases.is_empty() {
                return ProjectContextRelease::Retained;
            }
        } else {
            state.leases.clear();
        }
        state.phase = ProjectContextPhase::Releasing;
        drop(state);

        if wait_for_handles {
            self.wait_until_inactive().await;
        }
        let context = self.state.lock().await.context.take();
        ProjectContextRelease::Claimed(ProjectContextReleaseClaim {
            context,
            slot: Arc::clone(self),
        })
    }

    async fn existing_handle(self: &Arc<Self>) -> Option<ProjectContextHandle> {
        let state = self.state.lock().await;
        if state.phase != ProjectContextPhase::Active {
            return None;
        }
        let context = state.context.as_ref()?.clone();
        self.active_handles.fetch_add(1, Ordering::AcqRel);
        Some(ProjectContextHandle {
            context,
            slot: Arc::clone(self),
        })
    }

    async fn finish_release(&self) {
        let mut state = self.state.lock().await;
        state.phase = ProjectContextPhase::Released;
        drop(state);
        self.lifecycle_changed.notify_waiters();
    }

    pub(crate) async fn wait_until_released(&self) {
        loop {
            let notified = self.lifecycle_changed.notified();
            if self.state.lock().await.phase == ProjectContextPhase::Released {
                return;
            }
            notified.await;
        }
    }

    async fn wait_until_inactive(&self) {
        loop {
            let notified = self.active_handles_changed.notified();
            if self.active_handles.load(Ordering::Acquire) == 0 {
                return;
            }
            notified.await;
        }
    }
}

/// 活动 Context 引用；释放会等待全部 Handle 归还。
pub(crate) struct ProjectContextHandle {
    context: Arc<ProjectRuntimeContext>,
    slot: Arc<ProjectContextSlot>,
}

impl Deref for ProjectContextHandle {
    type Target = ProjectRuntimeContext;

    fn deref(&self) -> &Self::Target {
        &self.context
    }
}

impl Drop for ProjectContextHandle {
    fn drop(&mut self) {
        if self.slot.active_handles.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.slot.active_handles_changed.notify_waiters();
        }
    }
}

pub(crate) struct ProjectContextReleaseClaim {
    pub(crate) context: Option<Arc<ProjectRuntimeContext>>,
    slot: Arc<ProjectContextSlot>,
}

pub(crate) enum ProjectContextRelease {
    Claimed(ProjectContextReleaseClaim),
    Ignored,
    Retained,
}

/// 仅保留当前活跃或正在释放的 Project 槽。
pub(crate) struct ProjectContextRegistry {
    slots: Mutex<HashMap<ProjectId, Arc<ProjectContextSlot>>>,
}

impl ProjectContextRegistry {
    pub(crate) fn new() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) async fn slot(&self, project_id: &ProjectId) -> Arc<ProjectContextSlot> {
        self.slots
            .lock()
            .await
            .entry(project_id.clone())
            .or_insert_with(|| Arc::new(ProjectContextSlot::new()))
            .clone()
    }

    pub(crate) async fn begin_release(
        &self,
        project_id: &ProjectId,
        lease_id: Option<&str>,
    ) -> ProjectContextRelease {
        let slot = self.slots.lock().await.get(project_id).cloned();
        match slot {
            Some(slot) => slot.begin_release(lease_id).await,
            None => ProjectContextRelease::Ignored,
        }
    }

    pub(crate) async fn finish_release(
        &self,
        project_id: &ProjectId,
        claim: &ProjectContextReleaseClaim,
    ) {
        let mut slots = self.slots.lock().await;
        if slots
            .get(project_id)
            .is_some_and(|slot| Arc::ptr_eq(slot, &claim.slot))
        {
            slots.remove(project_id);
        }
        drop(slots);
        claim.slot.finish_release().await;
    }

    pub(crate) async fn ready_contexts(&self) -> Vec<(ProjectId, ProjectContextHandle)> {
        let slots = self
            .slots
            .lock()
            .await
            .iter()
            .map(|(project_id, slot)| (project_id.clone(), Arc::clone(slot)))
            .collect::<Vec<_>>();
        let mut contexts = Vec::with_capacity(slots.len());
        for (project_id, slot) in slots {
            if let Some(context) = slot.existing_handle().await {
                contexts.push((project_id, context));
            }
        }
        contexts
    }

    pub(crate) async fn project_ids(&self) -> Vec<ProjectId> {
        self.slots.lock().await.keys().cloned().collect()
    }
}
