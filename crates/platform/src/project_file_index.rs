use std::{
    cmp::Ordering,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use code_agent_core::PortRequestContext;
use ignore::{DirEntry, Error, ParallelVisitor, ParallelVisitorBuilder, WalkBuilder, WalkState};

use crate::{
    PlatformError,
    project_tree::{MAX_PROJECT_FILE_DEPTH, is_ignored_directory_name, is_ignored_file_name},
};

pub(crate) const MAX_PROJECT_FILE_SEARCH_RESULTS: usize = 50;
const WALKER_THREADS: usize = 4;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectFileSearchEntry {
    pub(crate) name: Box<str>,
    pub(crate) path: Box<str>,
}

#[derive(Debug)]
struct IndexedProjectFile {
    name: Box<str>,
    name_length: usize,
    normalized_name: Box<str>,
    path: Box<str>,
}

#[derive(Debug)]
pub(crate) struct ProjectFileIndex {
    entries: Box<[IndexedProjectFile]>,
    estimated_bytes: usize,
}

impl ProjectFileIndex {
    pub(crate) async fn build(
        root: &Path,
        context: &PortRequestContext,
    ) -> Result<Arc<Self>, PlatformError> {
        let root = root.to_owned();
        let context = context.clone();
        tokio::task::spawn_blocking(move || build_index(&root, &context))
            .await
            .map_err(|error| PlatformError::Worker(format!("file index worker failed: {error}")))?
            .map(Arc::new)
    }

    pub(crate) fn search(&self, query: &str) -> Vec<ProjectFileSearchEntry> {
        let normalized_query = query.to_lowercase();
        let mut exact = Vec::with_capacity(1);
        let mut prefix = Vec::with_capacity(MAX_PROJECT_FILE_SEARCH_RESULTS);
        let mut substring = Vec::with_capacity(MAX_PROJECT_FILE_SEARCH_RESULTS);

        for entry in &self.entries {
            let target = if normalized_query.is_empty()
                || entry.normalized_name.as_ref() == normalized_query
            {
                &mut exact
            } else if entry.normalized_name.starts_with(&normalized_query) {
                &mut prefix
            } else if entry.normalized_name.contains(&normalized_query) {
                &mut substring
            } else {
                continue;
            };
            if target.len() < MAX_PROJECT_FILE_SEARCH_RESULTS {
                target.push(ProjectFileSearchEntry {
                    name: entry.name.clone(),
                    path: entry.path.clone(),
                });
            }
        }
        exact
            .into_iter()
            .chain(prefix)
            .chain(substring)
            .take(MAX_PROJECT_FILE_SEARCH_RESULTS)
            .collect()
    }

    pub(crate) fn entry_count(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn estimated_bytes(&self) -> usize {
        self.estimated_bytes
    }
}

fn build_index(
    root: &Path,
    context: &PortRequestContext,
) -> Result<ProjectFileIndex, PlatformError> {
    if context.is_cancelled() {
        return Err(PlatformError::Cancelled);
    }
    let mut builder = WalkBuilder::new(root);
    builder
        .standard_filters(false)
        .follow_links(false)
        .max_depth(Some(MAX_PROJECT_FILE_DEPTH + 1))
        .threads(WALKER_THREADS);
    let root = root.to_owned();
    let collected = Arc::new(Mutex::new(IndexBuildState::default()));

    // 并行 visitor 只在每个 worker 结束时合并一次，避免逐文件争用共享锁。
    builder.build_parallel().visit(&mut IndexVisitorBuilder {
        context: context.clone(),
        root,
        state: Arc::clone(&collected),
    });

    if context.is_cancelled() {
        return Err(PlatformError::Cancelled);
    }
    let mut state = collected
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(error) = state.error.take() {
        return Err(PlatformError::Worker(format!(
            "file index traversal failed: {error}"
        )));
    }
    let mut entries = std::mem::take(&mut state.entries);
    entries.sort_unstable_by(compare_index_entries);
    let estimated_bytes = entries.iter().map(index_entry_bytes).sum();
    Ok(ProjectFileIndex {
        entries: entries.into_boxed_slice(),
        estimated_bytes,
    })
}

#[derive(Default)]
struct IndexBuildState {
    entries: Vec<IndexedProjectFile>,
    error: Option<String>,
}

struct IndexVisitorBuilder {
    context: PortRequestContext,
    root: PathBuf,
    state: Arc<Mutex<IndexBuildState>>,
}

impl<'s> ParallelVisitorBuilder<'s> for IndexVisitorBuilder {
    fn build(&mut self) -> Box<dyn ParallelVisitor + 's> {
        Box::new(IndexVisitor {
            context: self.context.clone(),
            entries: Vec::new(),
            root: self.root.clone(),
            state: Arc::clone(&self.state),
        })
    }
}

struct IndexVisitor {
    context: PortRequestContext,
    entries: Vec<IndexedProjectFile>,
    root: PathBuf,
    state: Arc<Mutex<IndexBuildState>>,
}

impl ParallelVisitor for IndexVisitor {
    fn visit(&mut self, entry: Result<DirEntry, Error>) -> WalkState {
        if self.context.is_cancelled() {
            return WalkState::Quit;
        }
        match entry {
            Ok(entry) => collect_file(&self.root, entry, &mut self.entries),
            Err(error) => {
                set_first_error(&self.state, error.to_string());
                WalkState::Quit
            }
        }
    }
}

impl Drop for IndexVisitor {
    fn drop(&mut self) {
        if self.entries.is_empty() {
            return;
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.entries.append(&mut self.entries);
    }
}

fn collect_file(root: &Path, entry: DirEntry, local: &mut Vec<IndexedProjectFile>) -> WalkState {
    let Some(file_type) = entry.file_type() else {
        return WalkState::Continue;
    };
    if file_type.is_dir() {
        if entry.depth() > 0
            && entry
                .file_name()
                .to_str()
                .is_some_and(is_ignored_directory_name)
        {
            return WalkState::Skip;
        }
        return WalkState::Continue;
    }
    if !file_type.is_file() || file_type.is_symlink() {
        return WalkState::Continue;
    }
    if entry.file_name().to_str().is_some_and(is_ignored_file_name) {
        return WalkState::Continue;
    }
    let Ok(relative) = entry.path().strip_prefix(root) else {
        return WalkState::Continue;
    };
    let name = entry.file_name().to_string_lossy().into_owned();
    local.push(IndexedProjectFile {
        name_length: name.chars().count(),
        normalized_name: name.to_lowercase().into_boxed_str(),
        name: name.into_boxed_str(),
        path: relative
            .to_string_lossy()
            .replace('\\', "/")
            .into_boxed_str(),
    });
    WalkState::Continue
}

fn set_first_error(state: &Mutex<IndexBuildState>, error: String) {
    let mut state = state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.error.is_none() {
        state.error = Some(error);
    }
}

fn compare_index_entries(left: &IndexedProjectFile, right: &IndexedProjectFile) -> Ordering {
    left.name_length
        .cmp(&right.name_length)
        .then_with(|| left.name.cmp(&right.name))
        .then_with(|| left.path.cmp(&right.path))
}

fn index_entry_bytes(entry: &IndexedProjectFile) -> usize {
    std::mem::size_of::<IndexedProjectFile>()
        + entry.name.len()
        + entry.normalized_name.len()
        + entry.path.len()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use code_agent_core::PortRequestContext;

    use super::ProjectFileIndex;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "code-agent-project-file-index-{name}-{}",
            std::process::id()
        ))
    }

    #[tokio::test]
    async fn search_should_match_names_and_rank_exact_prefix_then_substring() {
        let root = test_root("ranking");
        fs::create_dir_all(root.join("nested/deep")).expect("nested directory");
        fs::write(root.join("nested/deep/main.rs"), "").expect("exact file");
        fs::write(root.join("main.test.rs"), "").expect("prefix file");
        fs::write(root.join("domain.rs"), "").expect("substring file");
        fs::write(root.join("nested/main-short.rs"), "").expect("prefix nested file");
        fs::write(root.join("nested/main.rs.backup"), "").expect("prefix long file");
        let context = PortRequestContext::new("index-ranking-test");

        let index = ProjectFileIndex::build(&root, &context)
            .await
            .expect("file index");
        let results = index.search("main.rs");
        let paths = results
            .iter()
            .map(|entry| entry.path.as_ref())
            .collect::<Vec<_>>();

        assert_eq!(
            paths,
            vec!["nested/deep/main.rs", "nested/main.rs.backup", "domain.rs",]
        );
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn search_should_keep_gitignored_files_and_skip_generated_directories() {
        let root = test_root("boundaries");
        fs::create_dir_all(root.join("kept")).expect("kept directory");
        fs::create_dir_all(root.join("target/debug")).expect("target directory");
        fs::write(root.join(".DS_Store"), "finder metadata").expect("platform metadata");
        fs::write(root.join(".gitignore"), "kept/hidden.rs\n").expect("ignore file");
        fs::write(root.join("kept/hidden.rs"), "").expect("kept file");
        fs::write(root.join("target/debug/hidden.rs"), "").expect("generated file");
        let context = PortRequestContext::new("index-boundary-test");

        let index = ProjectFileIndex::build(&root, &context)
            .await
            .expect("file index");
        let results = index.search("hidden.rs");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path.as_ref(), "kept/hidden.rs");
        assert!(index.search(".DS_Store").is_empty());
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn search_should_limit_results_and_stop_after_depth_twenty() {
        let root = test_root("limits");
        fs::create_dir_all(&root).expect("root");
        for index in 0..60 {
            fs::write(root.join(format!("match-{index:02}.rs")), "").expect("matching file");
        }
        let depth_twenty = std::iter::repeat_n("inside", 20).collect::<PathBuf>();
        let depth_twenty_one = depth_twenty.join("outside");
        fs::create_dir_all(root.join(&depth_twenty_one)).expect("deep directory");
        fs::write(root.join(&depth_twenty).join("depth-match.rs"), "").expect("depth twenty file");
        fs::write(root.join(&depth_twenty_one).join("outside-match.rs"), "")
            .expect("depth twenty-one file");
        let context = PortRequestContext::new("index-limit-test");

        let index = ProjectFileIndex::build(&root, &context)
            .await
            .expect("file index");
        let results = index.search("match");

        assert_eq!(results.len(), 50);
        assert!(
            index
                .search("depth-match")
                .iter()
                .any(|entry| entry.name.as_ref() == "depth-match.rs")
        );
        assert!(index.search("outside-match").is_empty());
        fs::remove_dir_all(root).expect("remove root");
    }
}
