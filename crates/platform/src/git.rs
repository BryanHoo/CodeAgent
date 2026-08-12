use std::{
    path::{Path, PathBuf},
    str,
};

use async_trait::async_trait;
use code_agent_core::{CodeAgentError, CodeAgentErrorCode, GitPort, PortRequestContext};
use code_agent_protocol::ProjectId;
use rusqlite::OptionalExtension;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{PlatformDatabase, PlatformError, process::execute_git};

const HISTORY_PAGE_SIZE: usize = 20;
const COMMIT_FILES_PAGE_SIZE: usize = 100;
const MAX_DIFF_BYTES: usize = 512 * 1024;

#[derive(Clone)]
pub struct GitCliService {
    database: PlatformDatabase,
}

#[derive(Debug)]
struct WorkingEntry {
    index: u8,
    path: String,
    working: u8,
}

impl GitCliService {
    #[must_use]
    pub fn new(database: PlatformDatabase) -> Self {
        Self { database }
    }

    async fn project_root(&self, project_id: &ProjectId) -> Result<PathBuf, CodeAgentError> {
        let project_id = project_id.to_string();
        let root = self
            .database
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT root_path FROM projects WHERE id = ?1",
                        [project_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| PlatformError::Worker("project not found".to_owned()))
            })
            .map_err(map_platform_error)?;
        tokio::fs::canonicalize(root)
            .await
            .map_err(|_| not_found("project root was not found"))
    }

    async fn repository_root(
        &self,
        project_id: &ProjectId,
        repository: Option<&str>,
    ) -> Result<PathBuf, CodeAgentError> {
        let root = self.project_root(project_id).await?;
        if let Some(repository) = repository {
            if repository.is_empty()
                || repository.contains(['/', '\\'])
                || tokio::fs::symlink_metadata(root.join(".git")).await.is_ok()
            {
                return Err(not_found("git repository was not found"));
            }
            let candidate = root.join(repository);
            let metadata = tokio::fs::symlink_metadata(&candidate)
                .await
                .map_err(|_| not_found("git repository was not found"))?;
            let resolved = tokio::fs::canonicalize(&candidate)
                .await
                .map_err(|_| not_found("git repository was not found"))?;
            if metadata.file_type().is_symlink()
                || !metadata.is_dir()
                || resolved.parent() != Some(root.as_path())
                || tokio::fs::symlink_metadata(resolved.join(".git"))
                    .await
                    .is_err()
            {
                return Err(not_found("git repository was not found"));
            }
            return Ok(resolved);
        }
        if tokio::fs::symlink_metadata(root.join(".git"))
            .await
            .is_err()
        {
            return Err(not_found("git repository was not found"));
        }
        Ok(root)
    }

    async fn git(
        root: &Path,
        arguments: &[&str],
        context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        let arguments = arguments
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>();
        let output = execute_git(root, &arguments, None, context).await?;
        String::from_utf8(output.stdout).map_err(|_| invalid("git output is not UTF-8"))
    }

    async fn git_owned(
        root: &Path,
        arguments: Vec<String>,
        stdin: Option<&[u8]>,
        context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        let output = execute_git(root, &arguments, stdin, context).await?;
        String::from_utf8(output.stdout).map_err(|_| invalid("git output is not UTF-8"))
    }

    async fn read_status(
        &self,
        project_id: &ProjectId,
        repository: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let root = self.repository_root(project_id, repository).await?;
        let raw = Self::git(
            &root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            context,
        )
        .await?;
        let entries = parse_porcelain(raw.as_bytes())?;
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        for entry in entries.into_iter().take(1_000) {
            if entry.index != b' ' && entry.index != b'?' && entry.index != b'!' {
                staged.push(change_value(&root, &entry.path, entry.index, true, context).await?);
            }
            if entry.index == b'?' && entry.working == b'?' {
                unstaged.push(untracked_change(&root, &entry.path).await?);
            } else if entry.working != b' ' && entry.working != b'!' {
                unstaged
                    .push(change_value(&root, &entry.path, entry.working, false, context).await?);
            }
        }
        sort_changes(&mut staged);
        sort_changes(&mut unstaged);
        let branch = optional_git(&root, &["branch", "--show-current"], context)
            .await
            .trim()
            .to_owned();
        let branch = (!branch.is_empty()).then_some(branch);
        let local = optional_git(
            &root,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
            context,
        )
        .await;
        let mut branches = lines(&local);
        if let Some(current) = &branch
            && let Some(index) = branches.iter().position(|value| value == current)
        {
            let current = branches.remove(index);
            branches.insert(0, current);
        }
        let refs = optional_git(
            &root,
            &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
            context,
        )
        .await;
        let base_branches = lines(&refs)
            .into_iter()
            .filter(|value| !value.ends_with("/HEAD"))
            .collect::<Vec<_>>();
        let snapshot_payload = json!({
            "branch": branch,
            "repositoryMode": "root",
            "staged": staged,
            "unstaged": unstaged,
        });
        let snapshot = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&snapshot_payload)
                    .map_err(|_| internal("git snapshot failed"))?
            )
        );
        Ok(json!({
            "baseBranches": base_branches,
            "branch": branch,
            "branches": branches,
            "repositoryMode": "root",
            "snapshot": snapshot,
            "staged": staged,
            "unstaged": unstaged,
        }))
    }

    pub async fn history(
        &self,
        project_id: &ProjectId,
        query: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let repository = optional_string(query, "repository")?;
        let root = self.repository_root(project_id, repository).await?;
        let offset = parse_cursor(query.get("cursor"))?;
        let output = Self::git_owned(
            &root,
            vec![
                "log".to_owned(),
                format!("--max-count={}", HISTORY_PAGE_SIZE + 1),
                format!("--skip={offset}"),
                "--format=%H%x00%an%x00%ae%x00%aI%x00%s%x00".to_owned(),
                "HEAD".to_owned(),
            ],
            None,
            context,
        )
        .await?;
        let fields = output.split('\0').collect::<Vec<_>>();
        let mut commits = Vec::new();
        for chunk in fields.chunks(5) {
            if chunk.len() < 5 || chunk[0].trim().is_empty() {
                break;
            }
            commits.push(json!({
                "authoredAt": chunk[3].trim(),
                "authorEmail": nonempty(chunk[2], "unknown"),
                "authorName": nonempty(chunk[1], "Unknown"),
                "sha": chunk[0].trim(),
                "title": nonempty(chunk[4], chunk[0].get(..12).unwrap_or(chunk[0])),
            }));
        }
        let has_next = commits.len() > HISTORY_PAGE_SIZE;
        commits.truncate(HISTORY_PAGE_SIZE);
        let branch = Self::git(&root, &["branch", "--show-current"], context)
            .await?
            .trim()
            .to_owned();
        Ok(json!({
            "branch": (!branch.is_empty()).then_some(branch),
            "commits": commits,
            "nextCursor": has_next.then(|| (offset + HISTORY_PAGE_SIZE).to_string()),
            "repositories": [],
            "repository": repository,
            "repositoryMode": "root",
        }))
    }

    pub async fn commit_files(
        &self,
        project_id: &ProjectId,
        query: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let root = self
            .repository_root(project_id, optional_string(query, "repository")?)
            .await?;
        let sha = required_string(query, "sha")?;
        validate_sha(sha)?;
        let offset = parse_cursor(query.get("cursor"))?;
        let output = Self::git(
            &root,
            &[
                "diff-tree",
                "--root",
                "--no-commit-id",
                "--name-status",
                "-z",
                "-r",
                "--no-renames",
                sha,
                "--",
            ],
            context,
        )
        .await?;
        let fields = output.split('\0').collect::<Vec<_>>();
        let mut files = fields
            .chunks(2)
            .filter_map(|chunk| {
                let status = *chunk.first()?;
                let path = *chunk.get(1)?;
                (!status.is_empty() && !path.is_empty())
                    .then(|| json!({ "kind": change_kind(status.as_bytes()[0]), "path": path }))
            })
            .collect::<Vec<_>>();
        let next = (offset + COMMIT_FILES_PAGE_SIZE < files.len())
            .then(|| (offset + COMMIT_FILES_PAGE_SIZE).to_string());
        files = files
            .into_iter()
            .skip(offset)
            .take(COMMIT_FILES_PAGE_SIZE)
            .collect();
        Ok(json!({ "files": files, "nextCursor": next }))
    }

    pub async fn commit_diff(
        &self,
        project_id: &ProjectId,
        query: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let root = self
            .repository_root(project_id, optional_string(query, "repository")?)
            .await?;
        let sha = required_string(query, "sha")?;
        validate_sha(sha)?;
        let path = valid_relative_path(required_string(query, "path")?)?;
        let output = Self::git(
            &root,
            &[
                "show",
                "--format=",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--unified=3",
                sha,
                "--",
                path,
            ],
            context,
        )
        .await?;
        let (diff, truncated) = truncate_utf8(output, MAX_DIFF_BYTES);
        Ok(json!({ "diff": diff, "truncated": truncated }))
    }

    pub async fn create_branch(
        &self,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.mutate_branch(project_id, branch, expected_snapshot, true, context)
            .await
    }

    async fn mutate_branch(
        &self,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
        create: bool,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let status = self.read_status(project_id, None, context).await?;
        ensure_snapshot(&status, expected_snapshot)?;
        let root = self.repository_root(project_id, None).await?;
        let checked = Self::git(&root, &["check-ref-format", "--branch", branch], context).await?;
        if checked.trim() != branch {
            return Err(invalid("git branch name is invalid"));
        }
        if create {
            Self::git(&root, &["switch", "-c", branch], context).await?;
        } else {
            Self::git(&root, &["switch", "--no-guess", branch], context).await?;
        }
        self.read_status(project_id, None, context).await
    }

    pub async fn commit(
        &self,
        project_id: &ProjectId,
        request: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let repository = optional_string(request, "repository")?;
        let status = self.read_status(project_id, repository, context).await?;
        ensure_snapshot(&status, required_string(request, "expectedSnapshot")?)?;
        let message = required_string(request, "message")?;
        if message.trim().is_empty() || message.len() > 10_000 {
            return Err(invalid("commit message is invalid"));
        }
        let action = required_string(request, "action")?;
        if action != "commit" && action != "commit_and_push" {
            return Err(invalid("commit action is invalid"));
        }
        let paths = request
            .get("paths")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("commit paths are invalid"))?;
        if paths.is_empty() || paths.len() > 500 {
            return Err(invalid("commit paths are invalid"));
        }
        let changed = status["staged"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(status["unstaged"].as_array().into_iter().flatten())
            .filter_map(|value| value["path"].as_str())
            .collect::<std::collections::HashSet<_>>();
        let staged = status["staged"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| value["path"].as_str())
            .collect::<std::collections::HashSet<_>>();
        let untracked = status["unstaged"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|value| value["kind"] == "create")
            .filter_map(|value| value["path"].as_str())
            .filter(|path| !staged.contains(path))
            .collect::<std::collections::HashSet<_>>();
        let mut selected_paths = Vec::with_capacity(paths.len());
        let mut arguments = vec![
            "commit".to_owned(),
            "--only".to_owned(),
            "--file=-".to_owned(),
            "--".to_owned(),
        ];
        for value in paths {
            let path = valid_relative_path(
                value
                    .as_str()
                    .ok_or_else(|| invalid("commit path is invalid"))?,
            )?;
            if !changed.contains(path) {
                return Err(conflict("git changes changed before the commit"));
            }
            selected_paths.push(path.to_owned());
            arguments.push(path.to_owned());
        }
        let root = self.repository_root(project_id, repository).await?;
        let untracked_paths = selected_paths
            .iter()
            .filter(|path| untracked.contains(path.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if !untracked_paths.is_empty() {
            let mut prepare = vec![
                "add".to_owned(),
                "--intent-to-add".to_owned(),
                "--".to_owned(),
            ];
            prepare.extend(untracked_paths.iter().cloned());
            Self::git_owned(&root, prepare, None, context).await?;
        }

        if let Err(error) =
            Self::git_owned(&root, arguments, Some(message.as_bytes()), context).await
        {
            // 提交失败时撤销 intent-to-add，避免污染用户原有索引状态。
            if !untracked_paths.is_empty() {
                let mut reset = vec!["reset".to_owned(), "--".to_owned()];
                reset.extend(untracked_paths);
                let _ = Self::git_owned(&root, reset, None, context).await;
            }
            return Err(error);
        }
        let commit_sha = Self::git(&root, &["rev-parse", "HEAD"], context)
            .await?
            .trim()
            .to_owned();
        let push_status = if action == "commit_and_push" {
            if Self::git(
                &root,
                &[
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{upstream}",
                ],
                context,
            )
            .await
            .is_err()
            {
                "not_configured"
            } else if Self::git(&root, &["push"], context).await.is_ok() {
                "pushed"
            } else {
                "failed"
            }
        } else {
            "not_requested"
        };
        Ok(
            json!({ "branch": status["branch"], "commitSha": commit_sha, "message": message, "pushStatus": push_status }),
        )
    }
}

#[async_trait]
impl GitPort for GitCliService {
    async fn status(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.read_status(project_id, None, context).await
    }

    async fn status_for(
        &self,
        project_id: &ProjectId,
        repository: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.read_status(project_id, repository, context).await
    }

    async fn history(
        &self,
        project_id: &ProjectId,
        query: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.history(project_id, query, context).await
    }

    async fn commit_files(
        &self,
        project_id: &ProjectId,
        query: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.commit_files(project_id, query, context).await
    }

    async fn commit_diff(
        &self,
        project_id: &ProjectId,
        query: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.commit_diff(project_id, query, context).await
    }

    async fn switch_branch(
        &self,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.mutate_branch(project_id, branch, expected_snapshot, false, context)
            .await
    }

    async fn create_branch(
        &self,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.create_branch(project_id, branch, expected_snapshot, context)
            .await
    }

    async fn commit(
        &self,
        project_id: &ProjectId,
        request: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.commit(project_id, request, context).await
    }
}

async fn change_value(
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
    let diff = GitCliService::git(root, &arguments, context).await?;
    Ok(json!({ "diff": diff, "kind": change_kind(status), "path": path }))
}

async fn untracked_change(root: &Path, path: &str) -> Result<Value, CodeAgentError> {
    let relative = valid_relative_path(path)?;
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

fn change_kind(status: u8) -> &'static str {
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
async fn optional_git(root: &Path, arguments: &[&str], context: &PortRequestContext) -> String {
    GitCliService::git(root, arguments, context)
        .await
        .unwrap_or_default()
}
fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let value = value.trim();
    if value.is_empty() { fallback } else { value }
}
fn parse_cursor(value: Option<&Value>) -> Result<usize, CodeAgentError> {
    match value.and_then(Value::as_str) {
        None => Ok(0),
        Some(value) => value.parse().map_err(|_| invalid("git cursor is invalid")),
    }
}
fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CodeAgentError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("git request is invalid"))
}
fn optional_string<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, CodeAgentError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(Some)
            .ok_or_else(|| invalid("git request is invalid")),
    }
}
fn validate_sha(value: &str) -> Result<(), CodeAgentError> {
    if (40..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(invalid("git commit SHA is invalid"))
    }
}
fn valid_relative_path(value: &str) -> Result<&str, CodeAgentError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        Err(invalid("git path is invalid"))
    } else {
        Ok(value)
    }
}
fn ensure_snapshot(status: &Value, expected: &str) -> Result<(), CodeAgentError> {
    if status["snapshot"] == expected {
        Ok(())
    } else {
        Err(conflict("git working tree snapshot changed"))
    }
}
fn truncate_utf8(value: String, maximum: usize) -> (String, bool) {
    if value.len() <= maximum {
        return (value, false);
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_owned(), true)
}
fn map_platform_error(error: PlatformError) -> CodeAgentError {
    match error {
        PlatformError::Worker(message) if message == "project not found" => {
            not_found("project was not found")
        }
        _ => internal("project registry is unavailable"),
    }
}
fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}
fn not_found(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::NotFound, message, None)
}
fn conflict(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::Conflict, message, None)
}
fn internal(message: &'static str) -> CodeAgentError {
    CodeAgentError::internal(message)
}
