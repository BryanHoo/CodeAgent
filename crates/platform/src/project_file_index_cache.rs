use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use code_agent_core::PortRequestContext;
use tokio::sync::{Mutex, Notify};
use tokio_util::task::TaskTracker;

use crate::{
    PlatformError,
    project_file_index::ProjectFileIndex,
    project_file_index_budget::{MAX_INDEX_BYTES, MAX_INDEX_ENTRIES},
};

const CACHE_TTL: Duration = Duration::from_secs(30);
const MAX_CACHED_PROJECTS: usize = 8;
const MAX_CACHED_ENTRIES: usize = MAX_INDEX_ENTRIES;
const MAX_CACHED_BYTES: usize = MAX_INDEX_BYTES;
const BUILD_STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub(crate) struct ProjectFileIndexCache {
    inner: Arc<CacheInner>,
}

#[derive(Debug)]
struct CacheInner {
    state: Mutex<CacheState>,
    tasks: TaskTracker,
}

#[derive(Debug, Default)]
struct CacheState {
    entries: HashMap<Box<str>, CacheRecord>,
    sequence: u64,
    total_bytes: usize,
    total_file_entries: usize,
}

#[derive(Debug)]
struct CacheRecord {
    cached_bytes: usize,
    cached_entries: usize,
    last_access: u64,
    root: PathBuf,
    slot: Arc<BuildSlot>,
    valid_until: Instant,
}

#[derive(Debug)]
struct BuildSlot {
    context: PortRequestContext,
    notify: Notify,
    result: StdMutex<Option<Result<Arc<ProjectFileIndex>, BuildFailure>>>,
    waiters: AtomicUsize,
}

#[derive(Clone, Debug)]
enum BuildFailure {
    Cancelled,
    Message(Arc<str>),
}

impl ProjectFileIndexCache {
    pub(crate) fn new() -> Self {
        Self {
            inner: Arc::new(CacheInner {
                state: Mutex::new(CacheState::default()),
                tasks: TaskTracker::new(),
            }),
        }
    }

    pub(crate) async fn get_or_build(
        &self,
        project_id: &str,
        root: &Path,
        context: &PortRequestContext,
    ) -> Result<Arc<ProjectFileIndex>, PlatformError> {
        let (slot, should_build) = self.acquire_slot(project_id, root).await;
        let _waiter = BuildWaiter::new(Arc::clone(&slot));
        if should_build {
            self.spawn_build(project_id.into(), root.to_owned(), Arc::clone(&slot));
        }
        wait_for_result(&slot, context)
            .await
            .map_err(BuildFailure::into_error)
    }

    pub(crate) async fn release_project(&self, project_id: &str) -> Result<(), PlatformError> {
        let removed = {
            let mut state = self.inner.state.lock().await;
            remove_record(&mut state, project_id)
        };
        if let Some(record) = removed {
            record.slot.context.cancel();
            wait_for_build_stop(&record.slot).await?;
        }
        Ok(())
    }

    pub(crate) async fn close(&self) -> Result<(), PlatformError> {
        let entries = {
            let mut state = self.inner.state.lock().await;
            state.total_bytes = 0;
            state.total_file_entries = 0;
            state
                .entries
                .drain()
                .map(|(_, record)| record)
                .collect::<Vec<_>>()
        };
        for record in entries {
            record.slot.context.cancel();
        }
        self.inner.tasks.close();
        tokio::time::timeout(BUILD_STOP_TIMEOUT, self.inner.tasks.wait())
            .await
            .map_err(|_| PlatformError::Timeout)
    }

    async fn acquire_slot(&self, project_id: &str, root: &Path) -> (Arc<BuildSlot>, bool) {
        let now = Instant::now();
        let mut state = self.inner.state.lock().await;
        remove_expired(&mut state, now);
        state.sequence = state.sequence.wrapping_add(1);
        let access = state.sequence;
        if let Some(record) = state.entries.get_mut(project_id)
            && record.root == root
        {
            record.last_access = access;
            return (Arc::clone(&record.slot), false);
        }
        if let Some(previous) = remove_record(&mut state, project_id) {
            previous.slot.context.cancel();
        }
        let slot = Arc::new(BuildSlot::new(project_id));
        state.entries.insert(
            project_id.into(),
            CacheRecord {
                cached_bytes: 0,
                cached_entries: 0,
                last_access: access,
                root: root.to_owned(),
                slot: Arc::clone(&slot),
                valid_until: now + CACHE_TTL,
            },
        );
        evict_to_budget(&mut state, Some(project_id));
        (slot, true)
    }

    fn spawn_build(&self, project_id: Box<str>, root: PathBuf, slot: Arc<BuildSlot>) {
        let cache = self.clone();
        self.inner.tasks.spawn(async move {
            let result = ProjectFileIndex::build(&root, &slot.context)
                .await
                .map_err(BuildFailure::from);
            if let Ok(index) = &result {
                cache.complete_build(&project_id, &slot, index).await;
            } else {
                cache.remove_failed_build(&project_id, &slot).await;
            }
            *slot
                .result
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(result);
            slot.notify.notify_waiters();
        });
    }

    async fn complete_build(
        &self,
        project_id: &str,
        slot: &Arc<BuildSlot>,
        index: &ProjectFileIndex,
    ) {
        let mut state = self.inner.state.lock().await;
        let Some(record) = state.entries.get(project_id) else {
            return;
        };
        if !Arc::ptr_eq(&record.slot, slot) {
            return;
        }
        let cached_bytes = index.estimated_bytes();
        let cached_entries = index.entry_count();
        state.total_bytes = state.total_bytes.saturating_add(cached_bytes);
        state.total_file_entries = state.total_file_entries.saturating_add(cached_entries);
        if let Some(record) = state.entries.get_mut(project_id) {
            record.cached_bytes = cached_bytes;
            record.cached_entries = cached_entries;
        }
        evict_to_budget(&mut state, Some(project_id));
    }

    async fn remove_failed_build(&self, project_id: &str, slot: &Arc<BuildSlot>) {
        let mut state = self.inner.state.lock().await;
        if state
            .entries
            .get(project_id)
            .is_some_and(|record| Arc::ptr_eq(&record.slot, slot))
        {
            remove_record(&mut state, project_id);
        }
    }
}

impl BuildSlot {
    fn new(project_id: &str) -> Self {
        Self {
            context: PortRequestContext::new(format!("file-index:{project_id}")),
            notify: Notify::new(),
            result: StdMutex::new(None),
            waiters: AtomicUsize::new(0),
        }
    }
}

struct BuildWaiter {
    slot: Arc<BuildSlot>,
}

impl BuildWaiter {
    fn new(slot: Arc<BuildSlot>) -> Self {
        slot.waiters.fetch_add(1, Ordering::AcqRel);
        Self { slot }
    }
}

impl Drop for BuildWaiter {
    fn drop(&mut self) {
        if self.slot.waiters.fetch_sub(1, Ordering::AcqRel) == 1
            && self
                .slot
                .result
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_none()
        {
            self.slot.context.cancel();
        }
    }
}

async fn wait_for_result(
    slot: &BuildSlot,
    context: &PortRequestContext,
) -> Result<Arc<ProjectFileIndex>, BuildFailure> {
    loop {
        let notified = slot.notify.notified();
        if let Some(result) = slot
            .result
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
        {
            return result;
        }
        tokio::select! {
            () = context.cancelled() => return Err(BuildFailure::Cancelled),
            () = notified => {}
        }
    }
}

async fn wait_for_build_stop(slot: &BuildSlot) -> Result<(), PlatformError> {
    tokio::time::timeout(BUILD_STOP_TIMEOUT, async {
        loop {
            let notified = slot.notify.notified();
            if slot
                .result
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_some()
            {
                return;
            }
            notified.await;
        }
    })
    .await
    .map_err(|_| PlatformError::Timeout)
}

fn remove_expired(state: &mut CacheState, now: Instant) {
    let expired = state
        .entries
        .iter()
        .filter(|(_, record)| record.valid_until <= now)
        .map(|(project_id, _)| project_id.clone())
        .collect::<Vec<_>>();
    for project_id in expired {
        if let Some(record) = remove_record(state, &project_id) {
            record.slot.context.cancel();
        }
    }
}

fn evict_to_budget(state: &mut CacheState, protected_project: Option<&str>) {
    while state.entries.len() > MAX_CACHED_PROJECTS
        || state.total_file_entries > MAX_CACHED_ENTRIES
        || state.total_bytes > MAX_CACHED_BYTES
    {
        let candidate = state
            .entries
            .iter()
            .filter(|(project_id, _)| Some(project_id.as_ref()) != protected_project)
            .min_by_key(|(_, record)| record.last_access)
            .map(|(project_id, _)| project_id.clone())
            .or_else(|| protected_project.map(Into::into));
        let Some(project_id) = candidate else {
            break;
        };
        if let Some(record) = remove_record(state, &project_id) {
            record.slot.context.cancel();
        }
    }
}

fn remove_record(state: &mut CacheState, project_id: &str) -> Option<CacheRecord> {
    let record = state.entries.remove(project_id)?;
    state.total_bytes = state.total_bytes.saturating_sub(record.cached_bytes);
    state.total_file_entries = state
        .total_file_entries
        .saturating_sub(record.cached_entries);
    Some(record)
}

impl From<PlatformError> for BuildFailure {
    fn from(error: PlatformError) -> Self {
        match error {
            PlatformError::Cancelled => Self::Cancelled,
            error => Self::Message(error.to_string().into()),
        }
    }
}

impl BuildFailure {
    fn into_error(self) -> PlatformError {
        match self {
            Self::Cancelled => PlatformError::Cancelled,
            Self::Message(message) => PlatformError::Worker(message.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use code_agent_core::PortRequestContext;

    use super::ProjectFileIndexCache;

    #[tokio::test]
    async fn cache_should_reuse_truncated_index_within_budget() {
        let root = std::env::temp_dir().join(format!(
            "code-agent-project-file-cache-truncated-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("root");
        for index in 0..30 {
            fs::write(root.join(format!("file-{index:02}.rs")), "").expect("file");
        }
        let cache = ProjectFileIndexCache::new();
        let context = PortRequestContext::new("cache-truncated-test");

        let first = cache
            .get_or_build("project-truncated", &root, &context)
            .await
            .expect("first index");
        let second = cache
            .get_or_build("project-truncated", &root, &context)
            .await
            .expect("second index");

        assert!(Arc::ptr_eq(&first, &second));
        assert!(first.entry_count() <= crate::project_file_index_budget::MAX_INDEX_ENTRIES);
        assert!(first.estimated_bytes() <= crate::project_file_index_budget::MAX_INDEX_BYTES);

        cache.close().await.expect("close index cache");
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn cache_should_reuse_index_until_project_is_released() {
        let root = std::env::temp_dir().join(format!(
            "code-agent-project-file-cache-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("root");
        fs::write(root.join("main.rs"), "").expect("file");
        let cache = ProjectFileIndexCache::new();
        let context = PortRequestContext::new("cache-test");

        let first = cache
            .get_or_build("project-1", &root, &context)
            .await
            .expect("first index");
        let second = cache
            .get_or_build("project-1", &root, &context)
            .await
            .expect("second index");
        assert!(Arc::ptr_eq(&first, &second));

        cache
            .release_project("project-1")
            .await
            .expect("release project index");
        let rebuilt = cache
            .get_or_build("project-1", &root, &context)
            .await
            .expect("rebuilt index");
        assert!(!Arc::ptr_eq(&first, &rebuilt));

        cache.close().await.expect("close index cache");
        fs::remove_dir_all(root).expect("remove root");
    }
}
