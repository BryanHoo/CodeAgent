use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use ignore::WalkBuilder;
use serde::Serialize;

use super::path_guard::{WorkspaceError, relative_string};

const INDEX_CACHE_TTL: Duration = Duration::from_secs(5);
const MAX_CACHED_PROJECTS: usize = 8;
const MAX_SEARCH_RESULTS: usize = 50;

#[derive(Debug, Serialize)]
pub struct FileSearchPage {
    pub data: Vec<FileSearchEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchEntry {
    pub name: String,
    pub path: String,
    pub root_id: String,
    pub root_path: String,
}

#[derive(Debug)]
struct IndexedFile {
    lower_path: String,
    name: String,
    path: String,
}

#[derive(Debug)]
struct CachedIndex {
    created_at: Instant,
    files: Arc<[IndexedFile]>,
}

#[derive(Default)]
pub struct ProjectFileSearch {
    indexes: RwLock<HashMap<PathBuf, CachedIndex>>,
    sessions: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ProjectFileSearch {
    pub async fn search(
        &self,
        root: &Path,
        root_id: &str,
        query: &str,
        session_id: &str,
    ) -> Result<FileSearchPage, WorkspaceError> {
        let cancellation = self.start_session(session_id);
        let root = root.to_path_buf();
        let cached = self.cached_index(&root);
        let built_index = cached.is_none();
        let cancellation_for_task = Arc::clone(&cancellation);
        let query = query.trim().to_lowercase();
        let root_for_task = root.clone();
        let root_id = root_id.to_owned();
        let root_path = root.to_string_lossy().into_owned();
        let task = tokio::task::spawn_blocking(move || {
            let files = match cached {
                Some(files) => files,
                None => build_index(&root_for_task, &cancellation_for_task)?,
            };
            let data = search_index(&files, &query, &root_id, &root_path, &cancellation_for_task);
            Ok::<_, WorkspaceError>((files, data))
        })
        .await
        .map_err(|_| std::io::Error::other("project file search task failed"));
        self.finish_session(session_id, &cancellation);
        let (files, data) = task??;
        if cancellation.load(Ordering::Relaxed) {
            return Ok(FileSearchPage { data: Vec::new() });
        }
        if built_index {
            self.store_index(root, Arc::clone(&files));
        }
        Ok(FileSearchPage { data })
    }

    pub fn cancel(&self, session_id: &str) {
        if let Some(cancellation) = mutex_lock(&self.sessions).get(session_id) {
            cancellation.store(true, Ordering::Relaxed);
        }
    }

    pub fn invalidate(&self, root: &Path) {
        write_lock(&self.indexes).remove(root);
    }

    fn start_session(&self, session_id: &str) -> Arc<AtomicBool> {
        let cancellation = Arc::new(AtomicBool::new(false));
        if let Some(previous) =
            mutex_lock(&self.sessions).insert(session_id.to_owned(), Arc::clone(&cancellation))
        {
            // 同一会话只保留最新查询，快速输入不会留下并发扫描。
            previous.store(true, Ordering::Relaxed);
        }
        cancellation
    }

    fn finish_session(&self, session_id: &str, cancellation: &Arc<AtomicBool>) {
        let mut sessions = mutex_lock(&self.sessions);
        if sessions
            .get(session_id)
            .is_some_and(|current| Arc::ptr_eq(current, cancellation))
        {
            sessions.remove(session_id);
        }
    }

    fn cached_index(&self, root: &Path) -> Option<Arc<[IndexedFile]>> {
        read_lock(&self.indexes).get(root).and_then(|cached| {
            (cached.created_at.elapsed() < INDEX_CACHE_TTL).then(|| Arc::clone(&cached.files))
        })
    }

    fn store_index(&self, root: PathBuf, files: Arc<[IndexedFile]>) {
        let mut indexes = write_lock(&self.indexes);
        indexes.retain(|_, cached| cached.created_at.elapsed() < INDEX_CACHE_TTL);
        if indexes.len() >= MAX_CACHED_PROJECTS
            && !indexes.contains_key(&root)
            && let Some(oldest) = indexes
                .iter()
                .min_by_key(|(_, cached)| cached.created_at)
                .map(|(path, _)| path.clone())
        {
            // 项目根缓存保持有界，避免长时间运行后累积过期索引。
            indexes.remove(&oldest);
        }
        indexes.insert(
            root,
            CachedIndex {
                created_at: Instant::now(),
                files,
            },
        );
    }
}

fn build_index(
    root: &Path,
    cancellation: &AtomicBool,
) -> Result<Arc<[IndexedFile]>, WorkspaceError> {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(true)
        .parents(true)
        .ignore(true)
        .git_global(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false);
    let mut files = Vec::new();
    for entry in builder.build() {
        if cancellation.load(Ordering::Relaxed) {
            return Ok(Arc::from([]));
        }
        let entry = entry.map_err(|error| std::io::Error::other(error.to_string()))?;
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = relative_string(root, entry.path())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        files.push(IndexedFile {
            lower_path: path.to_lowercase(),
            name,
            path,
        });
    }
    files.sort_unstable_by(|left, right| {
        left.lower_path
            .cmp(&right.lower_path)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(Arc::from(files))
}

fn search_index(
    files: &[IndexedFile],
    query: &str,
    root_id: &str,
    root_path: &str,
    cancellation: &AtomicBool,
) -> Vec<FileSearchEntry> {
    let mut data = Vec::with_capacity(MAX_SEARCH_RESULTS);
    for file in files {
        if cancellation.load(Ordering::Relaxed) {
            break;
        }
        if query.is_empty() || file.lower_path.contains(query) {
            data.push(FileSearchEntry {
                name: file.name.clone(),
                path: file.path.clone(),
                root_id: root_id.to_owned(),
                root_path: root_path.to_owned(),
            });
            if data.len() == MAX_SEARCH_RESULTS {
                break;
            }
        }
    }
    data
}

fn mutex_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::*;

    #[tokio::test]
    async fn file_search_should_respect_project_ignore_rules() {
        let root = test_root("ignore");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("ignored")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join(".gitignore"), "ignored/\n").unwrap();
        fs::write(root.join("src/visible-match.rs"), "").unwrap();
        fs::write(root.join("ignored/ignored-match.rs"), "").unwrap();
        fs::write(root.join(".hidden/hidden-match.rs"), "").unwrap();
        let root = fs::canonicalize(root).unwrap();
        let search = ProjectFileSearch::default();

        let page = search
            .search(&root, "root-a", "match", "session-a")
            .await
            .unwrap();

        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].path, "src/visible-match.rs");
        assert_eq!(page.data[0].root_id, "root-a");
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn file_search_should_reuse_and_invalidate_the_project_index() {
        let root = test_root("cache");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/first.rs"), "").unwrap();
        let root = fs::canonicalize(root).unwrap();
        let search = ProjectFileSearch::default();
        search
            .search(&root, "root-a", "first", "session-a")
            .await
            .unwrap();
        fs::write(root.join("src/second.rs"), "").unwrap();

        let cached = search
            .search(&root, "root-a", "second", "session-b")
            .await
            .unwrap();
        search.invalidate(&root);
        let refreshed = search
            .search(&root, "root-a", "second", "session-c")
            .await
            .unwrap();

        assert!(cached.data.is_empty());
        assert_eq!(refreshed.data[0].path, "src/second.rs");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn starting_a_new_query_should_cancel_the_previous_session_token() {
        let search = ProjectFileSearch::default();
        let previous = search.start_session("session-a");

        let current = search.start_session("session-a");

        assert!(previous.load(Ordering::Relaxed));
        assert!(!current.load(Ordering::Relaxed));
    }

    #[test]
    fn stopping_a_query_should_set_its_cancellation_token() {
        let search = ProjectFileSearch::default();
        let cancellation = search.start_session("session-a");

        search.cancel("session-a");

        assert!(cancellation.load(Ordering::Relaxed));
    }

    #[test]
    fn project_index_cache_should_remain_bounded() {
        let search = ProjectFileSearch::default();

        for index in 0..=MAX_CACHED_PROJECTS {
            search.store_index(PathBuf::from(format!("/project-{index}")), Arc::from([]));
        }

        assert_eq!(read_lock(&search.indexes).len(), MAX_CACHED_PROJECTS);
    }

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("codeagent-search-{label}-{unique}"))
    }
}
