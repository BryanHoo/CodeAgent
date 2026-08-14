use std::{path::Path, str};

use code_agent_core::{CodeAgentError, PortRequestContext};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{GitCliService, git_repository_not_found, internal, invalid, not_found};

pub(super) const MAX_WORKING_ENTRIES: usize = 1_000;
const MAX_DIFF_CONCURRENCY: usize = 2;
const MAX_STATUS_CONCURRENCY: usize = 4;

#[derive(Debug)]
struct WorkingEntry {
    index: u8,
    path: String,
    working: u8,
}

impl GitCliService {
    pub(super) async fn read_status(
        &self,
        project_id: &code_agent_protocol::ProjectId,
        repository: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        if repository.is_none() {
            let root = self.project_root(project_id).await?;
            if tokio::fs::symlink_metadata(root.join(".git"))
                .await
                .is_err()
            {
                return self.read_children_status(&root, context).await;
            }
        }
        let root = self.repository_root(project_id, repository).await?;
        self.read_repository_status(&root, context).await
    }

    async fn read_repository_status(
        &self,
        root: &Path,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let (mut staged, mut unstaged, _) = self
            .read_working_changes(root, MAX_WORKING_ENTRIES, context)
            .await?;
        sort_changes(&mut staged);
        sort_changes(&mut unstaged);
        let branch = self
            .git(root, &["branch", "--show-current"], context)
            .await?
            .trim()
            .to_owned();
        let branch = (!branch.is_empty()).then_some(branch);
        let local = self
            .git(
                root,
                &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
                context,
            )
            .await?;
        let mut branches = lines(&local);
        if let Some(current) = &branch
            && let Some(index) = branches.iter().position(|value| value == current)
        {
            let current = branches.remove(index);
            branches.insert(0, current);
        }
        let refs = self
            .git(
                root,
                &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
                context,
            )
            .await?;
        let base_branches = lines(&refs)
            .into_iter()
            .filter(|value| !value.ends_with("/HEAD"))
            .collect::<Vec<_>>();
        status_value(branch, branches, base_branches, "root", staged, unstaged)
    }

    async fn read_children_status(
        &self,
        root: &Path,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let repositories = Self::child_repositories(root).await?;
        if repositories.is_empty() {
            return Err(git_repository_not_found());
        }
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut remaining = MAX_WORKING_ENTRIES;
        // 批内并发读取 Porcelain，批后按仓库排序消费全局预算，兼顾吞吐与快照确定性。
        for repository_batch in repositories.chunks(MAX_STATUS_CONCURRENCY) {
            if remaining == 0 {
                break;
            }
            let mut tasks = tokio::task::JoinSet::new();
            for (index, repository) in repository_batch.iter().enumerate() {
                let root = repository.root.clone();
                let context = context.clone();
                let service = self.clone();
                tasks.spawn(async move {
                    service
                        .read_working_entries(&root, MAX_WORKING_ENTRIES, &context)
                        .await
                        .map(|entries| (index, entries))
                });
            }
            let mut repository_entries = Vec::with_capacity(repository_batch.len());
            while let Some(result) = tasks.join_next().await {
                repository_entries.push(result.map_err(|_| internal("git status task failed"))??);
            }
            repository_entries.sort_by_key(|(index, _)| *index);
            for ((_, mut entries), repository) in
                repository_entries.into_iter().zip(repository_batch)
            {
                entries.truncate(remaining);
                remaining -= entries.len();
                let (repository_staged, repository_unstaged) = self
                    .materialize_working_changes(&repository.root, entries, context)
                    .await?;
                staged.extend(prefix_changes(&repository.name, repository_staged));
                unstaged.extend(prefix_changes(&repository.name, repository_unstaged));
            }
        }
        sort_changes(&mut staged);
        sort_changes(&mut unstaged);
        status_value(None, Vec::new(), Vec::new(), "children", staged, unstaged)
    }
    async fn read_working_changes(
        &self,
        root: &Path,
        maximum: usize,
        context: &PortRequestContext,
    ) -> Result<(Vec<Value>, Vec<Value>, usize), CodeAgentError> {
        let mut entries = self.read_working_entries(root, maximum, context).await?;
        entries.truncate(maximum);
        let entry_count = entries.len();
        let (staged, unstaged) = self
            .materialize_working_changes(root, entries, context)
            .await?;
        Ok((staged, unstaged, entry_count))
    }

    async fn read_working_entries(
        &self,
        root: &Path,
        maximum: usize,
        context: &PortRequestContext,
    ) -> Result<Vec<WorkingEntry>, CodeAgentError> {
        let raw = self
            .git(
                root,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                context,
            )
            .await?;
        let mut entries = parse_porcelain(raw.as_bytes())?;
        entries.truncate(maximum);
        Ok(entries)
    }

    async fn materialize_working_changes(
        &self,
        root: &Path,
        entries: Vec<WorkingEntry>,
        context: &PortRequestContext,
    ) -> Result<(Vec<Value>, Vec<Value>), CodeAgentError> {
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut indexed_entries = entries.into_iter().enumerate();
        loop {
            let batch = indexed_entries
                .by_ref()
                .take(MAX_DIFF_CONCURRENCY)
                .collect::<Vec<_>>();
            if batch.is_empty() {
                break;
            }
            let mut tasks = tokio::task::JoinSet::new();
            for (index, entry) in batch {
                let context = context.clone();
                let root = root.to_owned();
                let service = self.clone();
                tasks.spawn(async move {
                    service
                        .materialize_working_change(&root, entry, &context)
                        .await
                        .map(|(staged, unstaged)| (index, staged, unstaged))
                });
            }
            let mut changes = Vec::with_capacity(MAX_DIFF_CONCURRENCY);
            while let Some(result) = tasks.join_next().await {
                changes.push(result.map_err(|_| internal("git diff task failed"))??);
            }
            changes.sort_unstable_by_key(|(index, _, _)| *index);
            for (_, staged_change, unstaged_change) in changes {
                staged.extend(staged_change);
                unstaged.extend(unstaged_change);
            }
        }
        Ok((staged, unstaged))
    }

    async fn materialize_working_change(
        &self,
        root: &Path,
        entry: WorkingEntry,
        context: &PortRequestContext,
    ) -> Result<(Option<Value>, Option<Value>), CodeAgentError> {
        let staged = if entry.index != b' ' && entry.index != b'?' && entry.index != b'!' {
            Some(
                self.change_value(root, &entry.path, entry.index, true, context)
                    .await?,
            )
        } else {
            None
        };
        let unstaged = if entry.index == b'?' && entry.working == b'?' {
            Some(untracked_change(root, &entry.path).await?)
        } else if entry.working != b' ' && entry.working != b'!' {
            Some(
                self.change_value(root, &entry.path, entry.working, false, context)
                    .await?,
            )
        } else {
            None
        };
        Ok((staged, unstaged))
    }

    async fn change_value(
        &self,
        root: &Path,
        path: &str,
        status: u8,
        staged: bool,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let arguments = if staged {
            vec![
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                path,
            ]
        } else {
            vec!["diff", "--no-ext-diff", "--no-textconv", "--", path]
        };
        let diff = self.git(root, &arguments, context).await?;
        Ok(json!({ "diff": diff, "kind": change_kind(status), "path": path }))
    }
}

fn prefix_changes(repository: &str, mut changes: Vec<Value>) -> Vec<Value> {
    for change in &mut changes {
        if let Some(path) = change["path"].as_str() {
            change["path"] = Value::String(format!("{repository}/{path}"));
        }
    }
    changes
}

fn status_value(
    branch: Option<String>,
    branches: Vec<String>,
    base_branches: Vec<String>,
    repository_mode: &str,
    staged: Vec<Value>,
    unstaged: Vec<Value>,
) -> Result<Value, CodeAgentError> {
    let snapshot_payload = json!({
        "branch": branch,
        "repositoryMode": repository_mode,
        "staged": staged,
        "unstaged": unstaged,
    });
    let snapshot = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&snapshot_payload).map_err(|_| internal("git snapshot failed"))?
        )
    );
    Ok(json!({
        "baseBranches": base_branches,
        "branch": branch,
        "branches": branches,
        "repositoryMode": repository_mode,
        "snapshot": snapshot,
        "staged": staged,
        "unstaged": unstaged,
    }))
}

async fn untracked_change(root: &Path, path: &str) -> Result<Value, CodeAgentError> {
    let relative = super::valid_relative_path(path)?;
    let resolved = root.join(relative);
    let metadata = tokio::fs::symlink_metadata(&resolved)
        .await
        .map_err(|_| not_found("git file was not found"))?;
    let diff = if metadata.is_file() && metadata.len() <= 5 * 1024 * 1024 {
        let bytes = tokio::fs::read(&resolved)
            .await
            .map_err(|_| internal("git file could not be read"))?;
        if bytes.contains(&0) {
            String::new()
        } else {
            let text = String::from_utf8_lossy(&bytes);
            let lines = if text.is_empty() {
                0
            } else {
                text.lines().count()
            };
            format!(
                "--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{lines} @@\n{}",
                text.lines()
                    .map(|line| format!("+{line}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
    } else {
        String::new()
    };
    Ok(json!({ "diff": diff, "kind": "create", "path": path }))
}

fn parse_porcelain(output: &[u8]) -> Result<Vec<WorkingEntry>, CodeAgentError> {
    let records = output.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut entries = Vec::new();
    let mut index = 0;
    while let Some(record) = records.get(index) {
        if record.len() >= 4 {
            entries.push(WorkingEntry {
                index: record[0],
                working: record[1],
                path: str::from_utf8(&record[3..])
                    .map_err(|_| invalid("git path is not UTF-8"))?
                    .to_owned(),
            });
            if matches!(record[0], b'R' | b'C') || matches!(record[1], b'R' | b'C') {
                index += 1;
            }
        }
        index += 1;
    }
    Ok(entries)
}

pub(super) fn change_kind(status: u8) -> &'static str {
    match status {
        b'A' | b'?' => "create",
        b'D' => "delete",
        _ => "update",
    }
}

fn sort_changes(values: &mut [Value]) {
    values.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
}

fn lines(value: &str) -> Vec<String> {
    let mut values = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}
