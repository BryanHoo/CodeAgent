use std::{collections::HashMap, path::Path};

use tokio::io::AsyncReadExt;

use super::{git_process::run_git, git_read::GitChange, path_guard::WorkspaceError};

const MAX_DIFF_BYTES: usize = 512 * 1024;
const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

pub(super) async fn add_diffs(
    repo: &Path,
    changes: &mut [GitChange],
    staged: bool,
) -> Result<(), WorkspaceError> {
    if changes.is_empty() {
        return Ok(());
    }

    if staged || changes.iter().any(|change| change.kind != "create") {
        // raw `-z` 元数据提供无歧义路径，patch 主体按同序切分；每个区段只启动一次 Git。
        let mut args = vec![
            "diff",
            "--raw",
            "-z",
            "--patch",
            "--no-ext-diff",
            "--no-color",
        ];
        if staged {
            args.push("--cached");
        }
        let (output, _) = run_git(repo, &args, MAX_GIT_OUTPUT_BYTES).await?;
        apply_combined_diff(&output, changes)?;
    }

    if !staged {
        add_untracked_diffs(repo, changes).await?;
    }
    Ok(())
}

async fn add_untracked_diffs(repo: &Path, changes: &mut [GitChange]) -> Result<(), WorkspaceError> {
    let existing_bytes = changes
        .iter()
        .map(|change| change.diff.len())
        .sum::<usize>();
    let mut remaining_bytes = MAX_GIT_OUTPUT_BYTES.saturating_sub(existing_bytes);

    for change in changes.iter_mut().filter(|change| change.kind == "create") {
        let read_limit = remaining_bytes.min(MAX_DIFF_BYTES);
        if read_limit == 0 {
            break;
        }
        let path = repo.join(&change.path);
        let metadata = match tokio::fs::symlink_metadata(&path).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        // 符号链接不展开，避免把仓库外目标内容作为 Diff 返回。
        if !metadata.is_file() {
            continue;
        }
        let mut content = Vec::with_capacity(read_limit.min(8 * 1024));
        let file = match tokio::fs::File::open(path).await {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        file.take(read_limit as u64)
            .read_to_end(&mut content)
            .await?;
        if content.contains(&0) {
            continue;
        }

        let content = String::from_utf8_lossy(&content);
        let mut diff = String::with_capacity(read_limit);
        for line in content.split_inclusive('\n') {
            if diff.len() + line.len() + 1 > read_limit {
                break;
            }
            diff.push('+');
            diff.push_str(line);
        }
        remaining_bytes = remaining_bytes.saturating_sub(diff.len());
        change.diff = diff;
    }
    Ok(())
}

fn apply_combined_diff(output: &[u8], changes: &mut [GitChange]) -> Result<(), WorkspaceError> {
    if output.is_empty() {
        return Ok(());
    }
    let separator = output
        .windows(2)
        .position(|window| window == [0, 0])
        .ok_or_else(|| {
            WorkspaceError::GitCommandFailed("git diff returned incomplete metadata".to_owned())
        })?;
    let fields: Vec<_> = output[..=separator]
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect();
    let mut paths = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let metadata = fields[index];
        let status = metadata
            .rsplit(|byte| *byte == b' ')
            .next()
            .and_then(|value| value.first())
            .ok_or(WorkspaceError::InvalidPath)?;
        let path_count = if matches!(status, b'R' | b'C') { 2 } else { 1 };
        let path = fields
            .get(index + path_count)
            .ok_or(WorkspaceError::InvalidPath)?;
        paths.push(std::str::from_utf8(path).map_err(|_| WorkspaceError::InvalidPath)?);
        index += path_count + 1;
    }

    let patches = split_patch_chunks(&output[separator + 2..]);
    let change_indexes: HashMap<_, _> = changes
        .iter()
        .enumerate()
        .map(|(index, change)| (change.path.clone(), index))
        .collect();
    for (path, patch) in paths.into_iter().zip(patches) {
        let Some(index) = change_indexes.get(path).copied() else {
            continue;
        };
        let patch = &patch[..patch.len().min(MAX_DIFF_BYTES)];
        changes[index].diff = String::from_utf8_lossy(patch).into_owned();
    }
    Ok(())
}

fn split_patch_chunks(output: &[u8]) -> Vec<&[u8]> {
    const HEADER: &[u8] = b"\ndiff --git ";
    if output.is_empty() {
        return Vec::new();
    }
    let mut starts = vec![0];
    starts.extend(
        output
            .windows(HEADER.len())
            .enumerate()
            .filter_map(|(index, window)| (window == HEADER).then_some(index + 1)),
    );
    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = starts.get(index + 1).copied().unwrap_or(output.len());
            &output[*start..end]
        })
        .collect()
}
