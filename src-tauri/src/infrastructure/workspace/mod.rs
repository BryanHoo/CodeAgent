mod attachments;
mod file_search;
mod files;
mod git_diff;
mod git_process;
mod git_read;
mod git_worktree;
mod git_write;
mod open;
mod path_guard;
#[cfg(test)]
mod performance_baseline_tests;

#[cfg(test)]
mod git_diff_tests;
#[cfg(test)]
mod git_tests;

pub use attachments::{
    import_attachment, store_attachment, validate_attachment, validate_generated_attachment,
};
pub use file_search::ProjectFileSearch;
pub use files::{delete_project_file, list_project_files, read_source_file, rename_project_file};
pub use git_read::{get_commit_diff, get_commit_files, get_git_history, get_git_status};
pub use git_worktree::{create_worktree, list_worktrees, switch_worktree};
pub use git_write::{commit_changes, create_branch, prepare_commit_message, switch_branch};
pub use open::{open_path, platform_apps, reveal_path};
pub use path_guard::{WorkspaceError, canonical_root, resolve_existing};
