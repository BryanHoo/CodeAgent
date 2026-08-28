use std::{collections::HashMap, path::Path};

use super::{git_process::run_git, git_read::GitChange, path_guard::WorkspaceError};

const MAX_DIFF_BYTES: usize = 512 * 1024;
const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

pub(super) async fn add_diffs(
    repo: &Path,
    changes: &mut [GitChange],
    staged: bool,
) -> Result<(), WorkspaceError> {
    if changes.is_empty()
        || changes
            .iter()
            .all(|change| change.kind == "create" && !staged)
    {
        return Ok(());
    }
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
    apply_combined_diff(&output, changes)
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
