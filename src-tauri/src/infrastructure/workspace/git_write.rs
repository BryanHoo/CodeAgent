use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::Serialize;
use tokio::io::AsyncReadExt;

use super::{
    git_process::{run_git, run_git_with_index, run_network_git},
    git_read::{GitStatus, get_git_status, repository_path},
    path_guard::{WorkspaceError, valid_relative},
};

const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMMIT_CONTEXT_BYTES: usize = 512 * 1024;

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
            .flat_map(|change| {
                std::iter::once(change.path.as_str()).chain(change.original_path.as_deref())
            })
            .collect::<Vec<_>>(),
        true,
        &mut changes,
    )
    .await?;
    let tracked_unstaged: Vec<_> = unstaged
        .iter()
        .filter(|change| change.kind != "create")
        .flat_map(|change| {
            std::iter::once(change.path.as_str()).chain(change.original_path.as_deref())
        })
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
    let mut selected_staged: Vec<_> = paths
        .iter()
        .filter(|path| staged_paths.contains(path.as_str()))
        .collect();
    let selected_unstaged: Vec<_> = paths
        .iter()
        .filter(|path| !staged_paths.contains(path.as_str()))
        .collect();
    // 重命名是一项变更，隔离 index 和真实 index 必须同时处理旧路径删除与新路径写入。
    for change in &status.staged {
        if paths.contains(&change.path)
            && let Some(original) = &change.original_path
            && !selected_staged.contains(&original)
        {
            selected_staged.push(original);
        }
    }
    let literal_paths: Vec<_> = selected_staged
        .iter()
        .chain(&selected_unstaged)
        .map(|path| literal_path(path))
        .collect();
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
        // 隔离 index 构建期间内容仍可能变化，提交前再次拒绝过期预览。
        validate_snapshot(root, repository, expected_snapshot).await?;
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
    } else {
        let remotes = remote_names(&repo).await?;
        if remotes.is_empty() {
            (
                "not_configured",
                Some(WorkspaceError::NoUpstream.to_string()),
            )
        } else {
            push_current_branch(&repo, branch.as_deref(), &remotes).await
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

async fn push_current_branch(
    repo: &Path,
    branch: Option<&str>,
    remotes: &[String],
) -> (&'static str, Option<String>) {
    match run_network_git(repo, &["push"], MAX_GIT_OUTPUT_BYTES).await {
        Ok(_) => ("pushed", None),
        Err(WorkspaceError::NoUpstream) => {
            let remote = remotes
                .iter()
                .find(|remote| remote.as_str() == "origin")
                .or_else(|| (remotes.len() == 1).then(|| &remotes[0]));
            let (Some(branch), Some(remote)) = (branch, remote) else {
                return (
                    "not_configured",
                    Some(WorkspaceError::NoUpstream.to_string()),
                );
            };
            // 新建分支首次推送时一次性建立 upstream，后续继续走普通 push。
            match run_network_git(
                repo,
                &["push", "--set-upstream", remote, branch],
                MAX_GIT_OUTPUT_BYTES,
            )
            .await
            {
                Ok(_) => ("pushed", None),
                Err(error) => ("failed", Some(error.to_string())),
            }
        }
        Err(error) => ("failed", Some(error.to_string())),
    }
}

async fn remote_names(repo: &Path) -> Result<Vec<String>, WorkspaceError> {
    let output = run_git(repo, &["remote"], MAX_GIT_OUTPUT_BYTES).await?.0;
    Ok(String::from_utf8(output)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .map(str::to_owned)
        .collect())
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

pub(super) async fn validate_snapshot(
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

pub(super) async fn validate_branch(
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
