use std::path::Path;

use super::{
    git_process::run_git,
    git_read::repository_path,
    git_write::{CommitMessageContext, validate_paths, validate_snapshot},
    path_guard::WorkspaceError,
};

const MAX_COMMIT_CONTEXT_BYTES: usize = 512 * 1024;

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
        let content =
            super::git_untracked::read_content(&repo.join(&change.path), &repo, remaining).await?;
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
