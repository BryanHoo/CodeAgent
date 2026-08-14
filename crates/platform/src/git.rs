use std::path::{Path, PathBuf};

use async_trait::async_trait;
use code_agent_core::{AgentMutationErrorCode, CodeAgentError, GitPort, PortRequestContext};
use code_agent_protocol::ProjectId;
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

use crate::{
    PlatformDatabase, PlatformError, ProcessEnvironment,
    process::{GitCommandKind, execute_git},
};

mod mutation;
mod status;
mod support;

use support::{
    conflict, git_repository_not_found, internal, invalid, not_found, optional_string,
    required_string, valid_relative_path,
};
use support::{map_platform_error, nonempty, parse_cursor, truncate_utf8, validate_sha};

const HISTORY_PAGE_SIZE: usize = 20;
const MAX_HISTORY_REPOSITORIES: usize = 256;
const COMMIT_FILES_PAGE_SIZE: usize = 100;
const MAX_DIFF_BYTES: usize = 512 * 1024;

#[derive(Clone)]
pub struct GitCliService {
    database: PlatformDatabase,
    environment: ProcessEnvironment,
}

#[derive(Debug)]
struct ChildRepository {
    name: String,
    root: PathBuf,
}

impl GitCliService {
    #[must_use]
    pub fn new(database: PlatformDatabase, environment: ProcessEnvironment) -> Self {
        Self {
            database,
            environment,
        }
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
        tokio::fs::canonicalize(root).await.map_err(|_| {
            not_found("project root was not found")
                .with_mutation_code(AgentMutationErrorCode::ProjectNotFound)
        })
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
                return Err(git_repository_not_found());
            }
            let candidate = root.join(repository);
            let metadata = tokio::fs::symlink_metadata(&candidate)
                .await
                .map_err(|_| git_repository_not_found())?;
            let resolved = tokio::fs::canonicalize(&candidate)
                .await
                .map_err(|_| git_repository_not_found())?;
            if metadata.file_type().is_symlink()
                || !metadata.is_dir()
                || resolved.parent() != Some(root.as_path())
                || tokio::fs::symlink_metadata(resolved.join(".git"))
                    .await
                    .is_err()
            {
                return Err(git_repository_not_found());
            }
            return Ok(resolved);
        }
        if tokio::fs::symlink_metadata(root.join(".git"))
            .await
            .is_err()
        {
            return Err(git_repository_not_found());
        }
        Ok(root)
    }

    async fn child_repositories(root: &Path) -> Result<Vec<ChildRepository>, CodeAgentError> {
        let mut directory = tokio::fs::read_dir(root)
            .await
            .map_err(|_| git_repository_not_found())?;
        let mut repositories = Vec::new();
        while let Some(entry) = directory
            .next_entry()
            .await
            .map_err(|_| git_repository_not_found())?
        {
            let file_type = entry
                .file_type()
                .await
                .map_err(|_| git_repository_not_found())?;
            if !file_type.is_dir() {
                continue;
            }
            let candidate = entry.path();
            if tokio::fs::symlink_metadata(candidate.join(".git"))
                .await
                .is_err()
            {
                continue;
            }
            let resolved = tokio::fs::canonicalize(&candidate)
                .await
                .map_err(|_| git_repository_not_found())?;
            // 每次枚举都重新验证真实父目录，避免目录在读取期间被替换成越界链接。
            if resolved.parent() != Some(root) {
                continue;
            }
            repositories.push(ChildRepository {
                name: entry.file_name().to_string_lossy().into_owned(),
                root: resolved,
            });
        }
        repositories.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(repositories)
    }

    async fn git(
        &self,
        root: &Path,
        arguments: &[&str],
        context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        let arguments = arguments
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>();
        let output = execute_git(
            root,
            &arguments,
            None,
            GitCommandKind::Local,
            &self.environment,
            context,
        )
        .await?;
        String::from_utf8(output.stdout).map_err(|_| invalid("git output is not UTF-8"))
    }

    async fn push(
        &self,
        root: &Path,
        context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        let output = execute_git(
            root,
            &["push".to_owned()],
            None,
            GitCommandKind::Push,
            &self.environment,
            context,
        )
        .await?;
        String::from_utf8(output.stdout).map_err(|_| invalid("git output is not UTF-8"))
    }

    async fn git_owned(
        &self,
        root: &Path,
        arguments: Vec<String>,
        stdin: Option<&[u8]>,
        context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        let output = execute_git(
            root,
            &arguments,
            stdin,
            GitCommandKind::Local,
            &self.environment,
            context,
        )
        .await?;
        String::from_utf8(output.stdout).map_err(|_| invalid("git output is not UTF-8"))
    }

    pub async fn history(
        &self,
        project_id: &ProjectId,
        query: &Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let repository = optional_string(query, "repository")?.map(str::to_owned);
        let project_root = self.project_root(project_id).await?;
        let (root, repositories, repository, repository_mode) =
            if tokio::fs::symlink_metadata(project_root.join(".git"))
                .await
                .is_ok()
            {
                if repository.is_some() {
                    return Err(git_repository_not_found());
                }
                (project_root, Vec::new(), None, "root")
            } else {
                let child_repositories = Self::child_repositories(&project_root).await?;
                let repository = repository
                    .or_else(|| child_repositories.first().map(|value| value.name.clone()))
                    .ok_or_else(git_repository_not_found)?;
                let selected = child_repositories
                    .iter()
                    .find(|candidate| candidate.name == repository)
                    .ok_or_else(git_repository_not_found)?;
                let repositories = child_repositories
                    .iter()
                    .take(MAX_HISTORY_REPOSITORIES)
                    .map(|candidate| candidate.name.clone())
                    .collect::<Vec<_>>();
                if !repositories
                    .iter()
                    .any(|candidate| candidate == &repository)
                {
                    return Err(git_repository_not_found());
                }
                (
                    selected.root.clone(),
                    repositories,
                    Some(repository),
                    "children",
                )
            };
        let offset = parse_cursor(query.get("cursor"))?;
        let output = self
            .git_owned(
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
        let branch = self
            .git(&root, &["branch", "--show-current"], context)
            .await?
            .trim()
            .to_owned();
        Ok(json!({
            "branch": (!branch.is_empty()).then_some(branch),
            "commits": commits,
            "nextCursor": has_next.then(|| (offset + HISTORY_PAGE_SIZE).to_string()),
            "repositories": repositories,
            "repository": repository,
            "repositoryMode": repository_mode,
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
        let output = self
            .git(
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
                (!status.is_empty() && !path.is_empty()).then(
                    || json!({ "kind": status::change_kind(status.as_bytes()[0]), "path": path }),
                )
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
        let output = self
            .git(
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
