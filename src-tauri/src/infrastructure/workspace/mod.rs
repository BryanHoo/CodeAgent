mod attachments;
mod files;
mod git_process;
mod git_read;
mod git_write;
mod open;
mod path_guard;

#[cfg(test)]
mod git_tests;

pub use attachments::{import_attachment, store_attachment, validate_attachment};
pub use files::{
    delete_project_file, list_project_files, read_source_file, rename_project_file,
    search_project_files,
};
pub use git_read::{get_commit_diff, get_commit_files, get_git_history, get_git_status};
pub use git_write::{
    commit_changes, create_branch, create_worktree, list_worktrees, prepare_commit_message,
    switch_branch, switch_worktree,
};
pub use open::{open_path, platform_apps};
pub use path_guard::{canonical_root, resolve_existing};
