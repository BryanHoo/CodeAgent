use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::Serialize;
use tokio::io::AsyncReadExt;

use super::{
    git_process::{run_git, run_git_with_index},
    git_read::{GitStatus, get_git_status, repository_path},
    path_guard::{WorkspaceError, valid_relative},
};

const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMMIT_CONTEXT_BYTES: usize = 512 * 1024;

#[derive(Debug, Serialize)]
pub struct WorktreePage {
    pub worktrees: Vec<Worktree>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Worktree {
    pub branch: Option<String>,
    pub current: bool,
    pub path: String,
}

#[derive(Debug)]
pub struct CommitMessageContext {
    pub changes: String,
    pub snapshot: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitChangesResponse {
    pub branch: Option<String>,
    pub commit_sha: String,
    pub message: String,
    pub push_error: Option<String>,
    pub push_status: &'static str,
}

pub async fn switch_branch(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
    expected_snapshot: &str,
) -> Result<GitStatus, WorkspaceError> {
    validate_snapshot(root, repository, expected_snapshot).await?;
    validate_branch(root, repository, branch).await?;
    let repo = repository_path(root, repository).await?;
    run_git(&repo, &["switch", "--", branch], MAX_GIT_OUTPUT_BYTES).await?;
    get_git_status(root, repository, true).await
}

pub async fn create_branch(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
    expected_snapshot: &str,
) -> Result<GitStatus, WorkspaceError> {
    validate_snapshot(root, repository, expected_snapshot).await?;
    validate_branch(root, repository, branch).await?;
    let repo = repository_path(root, repository).await?;
    run_git(&repo, &["switch", "-c", branch], MAX_GIT_OUTPUT_BYTES).await?;
    get_git_status(root, repository, true).await
}

pub async fn list_worktrees(
    root: &Path,
    repository: Option<&str>,
) -> Result<WorktreePage, WorkspaceError> {
    let repo = repository_path(root, repository).await?;
    let output = run_git(
        &repo,
        &["worktree", "list", "--porcelain"],
        MAX_GIT_OUTPUT_BYTES,
    )
    .await?
    .0;
    let current = tokio::fs::canonicalize(&repo).await?;
    let mut worktrees = Vec::new();
    for block in String::from_utf8(output)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .split("\n\n")
    {
        let mut path = None;
        let mut branch = None;
        for line in block.lines() {
            if let Some(value) = line.strip_prefix("worktree ") {
                path = Some(value.to_owned());
            } else if let Some(value) = line.strip_prefix("branch refs/heads/") {
                branch = Some(value.to_owned());
            }
        }
        let Some(path) = path else { continue };
        let canonical = tokio::fs::canonicalize(&path).await?;
        worktrees.push(Worktree {
            branch,
            current: canonical == current,
            path: canonical.to_string_lossy().into_owned(),
        });
    }
    Ok(WorktreePage { worktrees })
}

pub async fn create_worktree(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
    expected_snapshot: &str,
) -> Result<Worktree, WorkspaceError> {
    validate_snapshot(root, repository, expected_snapshot).await?;
    validate_branch(root, repository, branch).await?;
    let repo = repository_path(root, repository).await?;
    let parent = repo.parent().ok_or(WorkspaceError::InvalidPath)?;
    let base = repo
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(WorkspaceError::InvalidPath)?;
    let suffix: String = branch
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let target = parent.join(format!("{base}-{suffix}"));
    if tokio::fs::try_exists(&target).await? {
        return Err(WorkspaceError::InvalidPath);
    }
    let status = get_git_status(root, repository, false).await?;
    let target_string = target.to_string_lossy().into_owned();
    let args = if status.branches.iter().any(|value| value == branch) {
        vec!["worktree", "add", target_string.as_str(), branch]
    } else {
        vec!["worktree", "add", "-b", branch, target_string.as_str()]
    };
    run_git(&repo, &args, MAX_GIT_OUTPUT_BYTES).await?;
    let canonical = tokio::fs::canonicalize(target).await?;
    Ok(Worktree {
        branch: Some(branch.to_owned()),
        current: false,
        path: canonical.to_string_lossy().into_owned(),
    })
}

pub async fn switch_worktree(
    root: &Path,
    repository: Option<&str>,
    path: &str,
) -> Result<Worktree, WorkspaceError> {
    let requested = tokio::fs::canonicalize(path).await?;
    list_worktrees(root, repository)
        .await?
        .worktrees
        .into_iter()
        .find(|worktree| Path::new(&worktree.path) == requested && !worktree.current)
        .ok_or(WorkspaceError::InvalidPath)
}

pub async fn prepare_commit_message(
    root: &Path,
    repository: Option<&str>,
    paths: &[String],
    expected_snapshot: &str,
) -> Result<CommitMessageContext, WorkspaceError> {
    validate_paths(paths)?;
    let status = validate_snapshot(root, repository, expected_snapshot).await?;
    let repo = repository_path(root, repository).await?;
    let staged: Vec<_> = status
        .staged
        .iter()
        .filter(|change| paths.contains(&change.path))
        .collect();
    let unstaged: Vec<_> = status
        .unstaged
        .iter()
        .filter(|change| paths.contains(&change.path))
        .collect();
    if staged.is_empty() && unstaged.is_empty() {
        return Err(WorkspaceError::InvalidPath);
    }
    let mut changes = String::new();
    for (area, change) in staged
        .iter()
        .map(|change| ("staged", *change))
        .chain(unstaged.iter().map(|change| ("unstaged", *change)))
    {
        append_bounded(
            &mut changes,
            &format!("## {area}: {} ({})\n", change.path, change.kind),
            MAX_COMMIT_CONTEXT_BYTES,
        );
    }

    append_selected_diff(
        &repo,
        &staged
            .iter()
            .map(|change| change.path.as_str())
            .collect::<Vec<_>>(),
        true,
        &mut changes,
    )
    .await?;
    let tracked_unstaged: Vec<_> = unstaged
        .iter()
        .filter(|change| change.kind != "create")
        .map(|change| change.path.as_str())
        .collect();
    append_selected_diff(&repo, &tracked_unstaged, false, &mut changes).await?;

    for change in unstaged.iter().filter(|change| change.kind == "create") {
        // 未跟踪文件没有 Git diff，仅读取剩余上下文容量，避免大文件占用过多内存。
        let remaining = MAX_COMMIT_CONTEXT_BYTES.saturating_sub(changes.len());
        let mut content = Vec::with_capacity(remaining.min(8 * 1024));
        if let Ok(file) = tokio::fs::File::open(repo.join(&change.path)).await {
            file.take(remaining as u64)
                .read_to_end(&mut content)
                .await?;
        }
        append_bounded(
            &mut changes,
            &String::from_utf8_lossy(&content),
            MAX_COMMIT_CONTEXT_BYTES,
        );
        append_bounded(&mut changes, "\n", MAX_COMMIT_CONTEXT_BYTES);
    }
    Ok(CommitMessageContext {
        changes,
        snapshot: status.snapshot,
    })
}

async fn append_selected_diff(
    repo: &Path,
    paths: &[&str],
    staged: bool,
    target: &mut String,
) -> Result<(), WorkspaceError> {
    if paths.is_empty() || target.len() >= MAX_COMMIT_CONTEXT_BYTES {
        return Ok(());
    }
    let mut args = vec!["diff", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.extend_from_slice(paths);
    let remaining = MAX_COMMIT_CONTEXT_BYTES - target.len();
    let (diff, _) = run_git(repo, &args, remaining).await?;
    append_bounded(
        target,
        &String::from_utf8_lossy(&diff),
        MAX_COMMIT_CONTEXT_BYTES,
    );
    Ok(())
}

fn append_bounded(target: &mut String, value: &str, limit: usize) {
    let remaining = limit.saturating_sub(target.len());
    let end = value.floor_char_boundary(remaining.min(value.len()));
    target.push_str(&value[..end]);
}

pub async fn commit_changes(
    root: &Path,
    repository: Option<&str>,
    paths: &[String],
    message: &str,
    action: &str,
    expected_snapshot: &str,
) -> Result<CommitChangesResponse, WorkspaceError> {
    validate_paths(paths)?;
    if message.trim().is_empty() || message.len() > 10_000 {
        return Err(WorkspaceError::InvalidPath);
    }
    if !matches!(action, "commit" | "commit_and_push") {
        return Err(WorkspaceError::InvalidPath);
    }
    let status = validate_snapshot(root, repository, expected_snapshot).await?;
    let repo = repository_path(root, repository).await?;
    let staged_paths: HashSet<_> = status
        .staged
        .iter()
        .map(|change| change.path.as_str())
        .collect();
    let selected_staged: Vec<_> = paths
        .iter()
        .filter(|path| staged_paths.contains(path.as_str()))
        .collect();
    let selected_unstaged: Vec<_> = paths
        .iter()
        .filter(|path| !staged_paths.contains(path.as_str()))
        .collect();
    let literal_paths: Vec<_> = paths.iter().map(|path| literal_path(path)).collect();
    let (temporary_root, temporary_index) = create_temporary_index().await?;

    let commit_result = async {
        // 从 HEAD 组装隔离 index，禁止未选择的暂存条目进入本次提交。
        run_git_with_index(
            &repo,
            &["read-tree", "HEAD"],
            MAX_GIT_OUTPUT_BYTES,
            &temporary_index,
            None,
        )
        .await?;
        if !selected_staged.is_empty() {
            let staged_literals: Vec<_> = selected_staged
                .iter()
                .map(|path| literal_path(path))
                .collect();
            let mut list_args = vec!["ls-files", "--stage", "-z", "--"];
            list_args.extend(staged_literals.iter().map(String::as_str));
            let (entries, truncated) = run_git(&repo, &list_args, MAX_GIT_OUTPUT_BYTES).await?;
            if truncated {
                return Err(WorkspaceError::InvalidPath);
            }

            let mut remove_args = vec!["update-index", "--force-remove", "--"];
            remove_args.extend(selected_staged.iter().map(|path| path.as_str()));
            run_git_with_index(
                &repo,
                &remove_args,
                MAX_GIT_OUTPUT_BYTES,
                &temporary_index,
                None,
            )
            .await?;
            if !entries.is_empty() {
                // 复制真实 index 条目，确保混合文件提交暂存版本而非工作区版本。
                run_git_with_index(
                    &repo,
                    &["update-index", "-z", "--index-info"],
                    MAX_GIT_OUTPUT_BYTES,
                    &temporary_index,
                    Some(&entries),
                )
                .await?;
            }
        }
        if !selected_unstaged.is_empty() {
            let unstaged_literals: Vec<_> = selected_unstaged
                .iter()
                .map(|path| literal_path(path))
                .collect();
            let mut add_args = vec!["add", "--"];
            add_args.extend(unstaged_literals.iter().map(String::as_str));
            run_git_with_index(
                &repo,
                &add_args,
                MAX_GIT_OUTPUT_BYTES,
                &temporary_index,
                None,
            )
            .await?;
        }
        run_git_with_index(
            &repo,
            &["commit", "--no-gpg-sign", "-m", message],
            MAX_GIT_OUTPUT_BYTES,
            &temporary_index,
            None,
        )
        .await?;
        Ok::<_, WorkspaceError>(())
    }
    .await;
    // 清理失败不能覆盖已完成的 commit 结果。
    let _ = tokio::fs::remove_dir_all(&temporary_root).await;
    commit_result?;

    let mut reset_args = vec!["reset", "--quiet", "HEAD", "--"];
    reset_args.extend(literal_paths.iter().map(String::as_str));
    run_git(&repo, &reset_args, MAX_GIT_OUTPUT_BYTES).await?;
    let commit_sha = first_line(&repo, &["rev-parse", "HEAD"]).await?;
    let branch = optional_line(&repo, &["branch", "--show-current"]).await?;
    let (push_status, push_error) = if action == "commit" {
        ("not_requested", None)
    } else if optional_line(&repo, &["remote"]).await?.is_none() {
        (
            "not_configured",
            Some(WorkspaceError::NoUpstream.to_string()),
        )
    } else {
        match run_git(&repo, &["push"], MAX_GIT_OUTPUT_BYTES).await {
            Ok(_) => ("pushed", None),
            Err(error @ WorkspaceError::NoUpstream) => ("not_configured", Some(error.to_string())),
            Err(error) => ("failed", Some(error.to_string())),
        }
    };
    Ok(CommitChangesResponse {
        branch,
        commit_sha,
        message: message.to_owned(),
        push_error,
        push_status,
    })
}

fn literal_path(path: &str) -> String {
    format!(":(literal){path}")
}

async fn create_temporary_index() -> Result<(PathBuf, PathBuf), WorkspaceError> {
    static NEXT_INDEX: AtomicU64 = AtomicU64::new(0);
    for _ in 0..16 {
        let sequence = NEXT_INDEX.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "codeagent-git-index-{}-{sequence}",
            std::process::id()
        ));
        match tokio::fs::create_dir(&root).await {
            Ok(()) => {
                let index = root.join("index");
                return Ok((root, index));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "temporary Git index path is unavailable",
    )
    .into())
}

async fn validate_snapshot(
    root: &Path,
    repository: Option<&str>,
    expected: &str,
) -> Result<GitStatus, WorkspaceError> {
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorkspaceError::InvalidPath);
    }
    let status = get_git_status(root, repository, false).await?;
    if status.snapshot != expected {
        return Err(WorkspaceError::SnapshotMismatch);
    }
    Ok(status)
}

async fn validate_branch(
    root: &Path,
    repository: Option<&str>,
    branch: &str,
) -> Result<(), WorkspaceError> {
    if branch.trim() != branch || branch.is_empty() || branch.len() > 1_024 {
        return Err(WorkspaceError::InvalidBranch);
    }
    let repo = repository_path(root, repository).await?;
    if run_git(
        &repo,
        &["check-ref-format", "--branch", branch],
        MAX_GIT_OUTPUT_BYTES,
    )
    .await
    .is_err()
    {
        return Err(WorkspaceError::InvalidBranch);
    }
    Ok(())
}

fn validate_paths(paths: &[String]) -> Result<(), WorkspaceError> {
    if paths.is_empty() || paths.len() > 500 {
        return Err(WorkspaceError::InvalidPath);
    }
    for path in paths {
        valid_relative(path)?;
    }
    Ok(())
}

async fn first_line(repo: &Path, args: &[&str]) -> Result<String, WorkspaceError> {
    optional_line(repo, args)
        .await?
        .ok_or(WorkspaceError::InvalidPath)
}

async fn optional_line(repo: &Path, args: &[&str]) -> Result<Option<String>, WorkspaceError> {
    let output = run_git(repo, args, MAX_GIT_OUTPUT_BYTES).await?.0;
    Ok(String::from_utf8(output)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned))
}
