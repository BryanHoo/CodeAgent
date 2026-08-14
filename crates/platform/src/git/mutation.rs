use code_agent_core::{AgentMutationErrorCode, CodeAgentError, PortRequestContext};
use code_agent_protocol::ProjectId;
use serde_json::{Value, json};

use super::{
    GitCliService, conflict, internal, invalid, not_found, optional_string, required_string,
    valid_relative_path,
};

fn ensure_snapshot(status: &Value, expected: &str) -> Result<(), CodeAgentError> {
    if status["snapshot"] == expected {
        Ok(())
    } else {
        Err(conflict("git working tree snapshot changed")
            .with_mutation_code(AgentMutationErrorCode::GitStatusChanged))
    }
}

impl GitCliService {
    pub(super) async fn create_branch(
        &self,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.mutate_branch(project_id, branch, expected_snapshot, true, context)
            .await
    }

    pub(super) async fn mutate_branch(
        &self,
        project_id: &ProjectId,
        branch: &str,
        expected_snapshot: &str,
        create: bool,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let status = self.read_status(project_id, None, context).await?;
        ensure_snapshot(&status, expected_snapshot)?;
        let branches = status["branches"]
            .as_array()
            .ok_or_else(|| internal("git branch catalog is invalid"))?;
        if create && branches.iter().any(|candidate| candidate == branch) {
            return Err(conflict("git branch already exists")
                .with_mutation_code(AgentMutationErrorCode::GitBranchAlreadyExists));
        }
        if !create && !branches.iter().any(|candidate| candidate == branch) {
            return Err(not_found("git branch was not found")
                .with_mutation_code(AgentMutationErrorCode::GitBranchNotFound));
        }
        if !create && status["branch"] == branch {
            return Err(conflict("git branch is already active")
                .with_mutation_code(AgentMutationErrorCode::GitBranchAlreadyActive));
        }
        let root = self.repository_root(project_id, None).await?;
        let checked = self
            .git(&root, &["check-ref-format", "--branch", branch], context)
            .await
            .map_err(|_| {
                invalid("git branch name is invalid")
                    .with_mutation_code(AgentMutationErrorCode::GitBranchInvalid)
            })?;
        if checked.trim() != branch {
            return Err(invalid("git branch name is invalid")
                .with_mutation_code(AgentMutationErrorCode::GitBranchInvalid));
        }
        if create {
            self.git(&root, &["switch", "-c", branch], context)
                .await
                .map_err(|_| {
                    internal("git branch creation failed")
                        .with_mutation_code(AgentMutationErrorCode::GitBranchCreateFailed)
                })?;
        } else {
            self.git(&root, &["switch", "--no-guess", branch], context)
                .await
                .map_err(|_| {
                    internal("git branch switch failed")
                        .with_mutation_code(AgentMutationErrorCode::GitBranchSwitchFailed)
                })?;
        }
        self.read_status(project_id, None, context).await
    }

    pub(super) async fn commit(
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
                return Err(conflict("git changes changed before the commit")
                    .with_mutation_code(AgentMutationErrorCode::GitPathUnavailable));
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
            self.git_owned(&root, prepare, None, context).await?;
        }

        if let Err(error) = self
            .git_owned(&root, arguments, Some(message.as_bytes()), context)
            .await
        {
            // 提交失败时撤销 intent-to-add，避免污染用户原有索引状态。
            if !untracked_paths.is_empty() {
                let mut reset = vec!["reset".to_owned(), "--".to_owned()];
                reset.extend(untracked_paths);
                let _ = self.git_owned(&root, reset, None, context).await;
            }
            return Err(error);
        }
        let commit_sha = self
            .git(&root, &["rev-parse", "HEAD"], context)
            .await?
            .trim()
            .to_owned();
        let push_status = if action == "commit_and_push" {
            if self
                .git(
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
            } else if self.git(&root, &["push"], context).await.is_ok() {
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
