use std::{
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::{Duration, Instant},
};

pub(crate) const MAX_INDEX_ENTRIES: usize = 250_000;
pub(crate) const MAX_INDEX_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const INDEX_BUILD_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub(crate) struct IndexBuildBudget {
    pub max_entries: usize,
    pub max_bytes: usize,
    pub deadline: Instant,
}

impl IndexBuildBudget {
    pub(crate) fn production() -> Self {
        Self {
            max_entries: MAX_INDEX_ENTRIES,
            max_bytes: MAX_INDEX_BYTES,
            deadline: Instant::now() + INDEX_BUILD_DEADLINE,
        }
    }
}

#[derive(Debug)]
pub(crate) struct IndexBudgetTracker {
    bytes: AtomicUsize,
    deadline: Instant,
    entries: AtomicUsize,
    max_bytes: usize,
    max_entries: usize,
    truncated: AtomicBool,
}

impl IndexBudgetTracker {
    pub(crate) fn new(budget: &IndexBuildBudget) -> Self {
        Self {
            bytes: AtomicUsize::new(0),
            deadline: budget.deadline,
            entries: AtomicUsize::new(0),
            max_bytes: budget.max_bytes,
            max_entries: budget.max_entries,
            truncated: AtomicBool::new(false),
        }
    }

    pub(crate) fn should_stop(&self, cancelled: bool) -> bool {
        cancelled
            || self.truncated.load(Ordering::Acquire)
            || Instant::now() >= self.deadline
    }

    pub(crate) fn truncated(&self) -> bool {
        self.truncated.load(Ordering::Acquire)
            || Instant::now() >= self.deadline
    }

    /// 并行 worker 在入队前预留条目配额；失败表示应停止遍历并标记截断。
    pub(crate) fn try_reserve(&self, entry_bytes: usize) -> bool {
        if Instant::now() >= self.deadline {
            self.truncated.store(true, Ordering::Release);
            return false;
        }
        let entry_index = self.entries.fetch_add(1, Ordering::AcqRel) + 1;
        if entry_index > self.max_entries {
            self.truncated.store(true, Ordering::Release);
            return false;
        }
        let total_bytes = self.bytes.fetch_add(entry_bytes, Ordering::AcqRel) + entry_bytes;
        if total_bytes > self.max_bytes {
            self.truncated.store(true, Ordering::Release);
            return false;
        }
        true
    }
}
