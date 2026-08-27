use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::{io::AsyncReadExt, process::Command};

use super::path_guard::{WorkspaceError, valid_relative};

const MAX_DIFF_BYTES: usize = 512 * 1024;
const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub base_branches: Vec<String>,
    pub branch: Option<String>,
    pub branches: Vec<String>,
    pub repository_mode: &'static str,
    pub snapshot: String,
    pub staged: Vec<GitChange>,
    pub unstaged: Vec<GitChange>,
}

#[derive(Debug, Serialize)]
pub struct GitChange {
    pub diff: String,
    pub kind: &'static str,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryPage {
    pub branch: Option<String>,
    pub commits: Vec<GitCommit>,
    pub next_cursor: Option<String>,
    pub repositories: Vec<String>,
    pub repository: Option<String>,
    pub repository_mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub authored_at: String,
    pub author_email: String,
    pub author_name: String,
    pub sha: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFilesPage {
    pub files: Vec<CommitFile>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CommitFile {
    pub kind: &'static str,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct CommitDiff {
    pub diff: String,
    pub truncated: bool,
}

struct RepositorySelection {
    mode: &'static str,
    path: Option<PathBuf>,
    repositories: Vec<String>,
    repository: Option<String>,
}

pub async fn get_git_status(
    root: &Path,
    repository: Option<&str>,
    include_diff: bool,
) -> Result<GitStatus, WorkspaceError> {
    let selected = select_repository(root, repository).await?;
    let Some(repo) = selected.path else {
        return Ok(GitStatus {
            base_branches: Vec::new(),
            branch: None,
            branches: Vec::new(),
            repository_mode: selected.mode,
            snapshot: hash_parts(&selected.repositories),
            staged: Vec::new(),
            unstaged: Vec::new(),
        });
    };
    let status_output = run_git(
        &repo,
        &["-c", "core.quotepath=false", "status", "--porcelain=v1"],
        MAX_GIT_OUTPUT_BYTES,
    )
    .await?
    .0;
    let branch = optional_git_line(&repo, &["branch", "--show-current"]).await?;
    let head = optional_git_line(&repo, &["rev-parse", "HEAD"]).await?;
    let branches = git_lines(
        &repo,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    .await?;
    let base_branches = branches
        .iter()
        .filter(|branch| matches!(branch.as_str(), "main" | "master"))
        .cloned()
        .collect();
    let (mut staged, mut unstaged) = parse_status(
        &String::from_utf8(status_output.clone()).map_err(|_| WorkspaceError::InvalidPath)?,
    )?;
    if include_diff {
        add_diffs(&repo, &mut staged, true).await?;
        add_diffs(&repo, &mut unstaged, false).await?;
    }
    let mut snapshot_parts = vec![String::from_utf8_lossy(&status_output).into_owned()];
    snapshot_parts.push(head.unwrap_or_default());
    snapshot_parts.push(branch.clone().unwrap_or_default());
    Ok(GitStatus {
        base_branches,
        branch,
        branches,
        repository_mode: selected.mode,
        snapshot: hash_parts(&snapshot_parts),
        staged,
        unstaged,
    })
}

pub async fn get_git_history(
    root: &Path,
    repository: Option<&str>,
    cursor: Option<&str>,
) -> Result<GitHistoryPage, WorkspaceError> {
    let selected = select_repository(root, repository).await?;
    let Some(repo) = selected.path.as_ref() else {
        return Ok(GitHistoryPage {
            branch: None,
            commits: Vec::new(),
            next_cursor: None,
            repositories: selected.repositories,
            repository: selected.repository,
            repository_mode: selected.mode,
        });
    };
    let offset = parse_cursor(cursor)?;
    let skip = format!("--skip={offset}");
    let output = run_git(
        repo,
        &[
            "log",
            "-21",
            &skip,
            "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
        ],
        MAX_GIT_OUTPUT_BYTES,
    )
    .await?
    .0;
    let mut commits = parse_history(&output)?;
    let has_more = commits.len() > 20;
    commits.truncate(20);
    Ok(GitHistoryPage {
        branch: optional_git_line(repo, &["branch", "--show-current"]).await?,
        commits,
        next_cursor: has_more.then(|| (offset + 20).to_string()),
        repositories: selected.repositories,
        repository: selected.repository,
        repository_mode: selected.mode,
    })
}

pub async fn get_commit_files(
    root: &Path,
    repository: Option<&str>,
    sha: &str,
    cursor: Option<&str>,
) -> Result<CommitFilesPage, WorkspaceError> {
    validate_sha(sha)?;
    let selected = select_repository(root, repository).await?;
    let repo = selected.path.ok_or(WorkspaceError::InvalidPath)?;
    let output = run_git(
        &repo,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-z",
            sha,
        ],
        MAX_GIT_OUTPUT_BYTES,
    )
    .await?
    .0;
    let offset = parse_cursor(cursor)?;
    let all = parse_commit_files(&output)?;
    let files = all.iter().skip(offset).take(100).cloned().collect();
    let next_cursor = (offset + 100 < all.len()).then(|| (offset + 100).to_string());
    Ok(CommitFilesPage { files, next_cursor })
}

pub async fn get_commit_diff(
    root: &Path,
    repository: Option<&str>,
    sha: &str,
    relative: &str,
) -> Result<CommitDiff, WorkspaceError> {
    validate_sha(sha)?;
    valid_relative(relative)?;
    let selected = select_repository(root, repository).await?;
    let repo = selected.path.ok_or(WorkspaceError::InvalidPath)?;
    let (output, truncated) = run_git(
        &repo,
        &["show", "--format=", "--no-ext-diff", sha, "--", relative],
        MAX_DIFF_BYTES,
    )
    .await?;
    Ok(CommitDiff {
        diff: String::from_utf8_lossy(&output).into_owned(),
        truncated,
    })
}

async fn select_repository(
    root: &Path,
    requested: Option<&str>,
) -> Result<RepositorySelection, WorkspaceError> {
    if tokio::fs::try_exists(root.join(".git")).await? {
        if requested.is_some() {
            return Err(WorkspaceError::InvalidPath);
        }
        return Ok(RepositorySelection {
            mode: "root",
            path: Some(root.to_path_buf()),
            repositories: Vec::new(),
            repository: None,
        });
    }
    let mut repositories = Vec::new();
    let mut reader = tokio::fs::read_dir(root).await?;
    while let Some(entry) = reader.next_entry().await? {
        if entry.file_type().await?.is_dir()
            && tokio::fs::try_exists(entry.path().join(".git")).await?
        {
            repositories.push(entry.file_name().to_string_lossy().into_owned());
            if repositories.len() == 256 {
                break;
            }
        }
    }
    repositories.sort_unstable();
    let repository = requested.map(str::to_owned);
    let path = match requested {
        Some(requested) if repositories.iter().any(|value| value == requested) => {
            Some(root.join(valid_relative(requested)?))
        }
        Some(_) => return Err(WorkspaceError::InvalidPath),
        None => None,
    };
    Ok(RepositorySelection {
        mode: if repositories.is_empty() {
            "none"
        } else {
            "children"
        },
        path,
        repositories,
        repository,
    })
}

pub(super) async fn repository_path(
    root: &Path,
    requested: Option<&str>,
) -> Result<PathBuf, WorkspaceError> {
    select_repository(root, requested)
        .await?
        .path
        .ok_or(WorkspaceError::InvalidPath)
}

fn parse_status(output: &str) -> Result<(Vec<GitChange>, Vec<GitChange>), WorkspaceError> {
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    for line in output.lines().filter(|line| !line.is_empty()) {
        let bytes = line.as_bytes();
        if bytes.len() < 4 || bytes[2] != b' ' {
            return Err(WorkspaceError::InvalidPath);
        }
        let path = line[3..]
            .rsplit_once(" -> ")
            .map_or(&line[3..], |(_, path)| path);
        valid_relative(path)?;
        let change = |code| GitChange {
            diff: String::new(),
            kind: change_kind(code),
            path: path.to_owned(),
        };
        if bytes[0] == b'?' && bytes[1] == b'?' {
            unstaged.push(change(b'?'));
        } else {
            if bytes[0] != b' ' {
                staged.push(change(bytes[0]));
            }
            if bytes[1] != b' ' {
                unstaged.push(change(bytes[1]));
            }
        }
    }
    Ok((staged, unstaged))
}

async fn add_diffs(
    repo: &Path,
    changes: &mut [GitChange],
    staged: bool,
) -> Result<(), WorkspaceError> {
    for change in changes {
        if change.kind == "create" && !staged {
            continue;
        }
        let mut args = vec!["diff", "--no-ext-diff"];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", change.path.as_str()]);
        let (diff, _) = run_git(repo, &args, MAX_DIFF_BYTES).await?;
        change.diff = String::from_utf8_lossy(&diff).into_owned();
    }
    Ok(())
}

fn parse_history(output: &[u8]) -> Result<Vec<GitCommit>, WorkspaceError> {
    String::from_utf8_lossy(output)
        .split('\u{1e}')
        .filter_map(|record| {
            let fields: Vec<&str> = record.trim().split('\u{1f}').collect();
            (!record.trim().is_empty()).then_some(fields)
        })
        .map(|fields| {
            if fields.len() != 5 || fields.iter().any(|field| field.is_empty()) {
                return Err(WorkspaceError::InvalidPath);
            }
            Ok(GitCommit {
                sha: fields[0].to_owned(),
                author_name: fields[1].to_owned(),
                author_email: fields[2].to_owned(),
                authored_at: fields[3].to_owned(),
                title: fields[4].to_owned(),
            })
        })
        .collect()
}

fn parse_commit_files(output: &[u8]) -> Result<Vec<CommitFile>, WorkspaceError> {
    let fields: Vec<&[u8]> = output
        .split(|byte| *byte == 0)
        .filter(|value| !value.is_empty())
        .collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let status = fields[index];
        let rename = status
            .first()
            .is_some_and(|value| matches!(value, b'R' | b'C'));
        let path_index = index + if rename { 2 } else { 1 };
        let path = fields.get(path_index).ok_or(WorkspaceError::InvalidPath)?;
        let path = std::str::from_utf8(path).map_err(|_| WorkspaceError::InvalidPath)?;
        valid_relative(path)?;
        files.push(CommitFile {
            kind: change_kind(*status.first().ok_or(WorkspaceError::InvalidPath)?),
            path: path.to_owned(),
        });
        index += if rename { 3 } else { 2 };
    }
    Ok(files)
}

fn change_kind(code: u8) -> &'static str {
    match code {
        b'A' | b'?' => "create",
        b'D' => "delete",
        _ => "update",
    }
}

fn parse_cursor(cursor: Option<&str>) -> Result<usize, WorkspaceError> {
    cursor
        .unwrap_or("0")
        .parse()
        .map_err(|_| WorkspaceError::InvalidPath)
}

fn validate_sha(sha: &str) -> Result<(), WorkspaceError> {
    if (40..=64).contains(&sha.len()) && sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(WorkspaceError::InvalidPath)
    }
}

fn hash_parts(parts: &[String]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn git_lines(repo: &Path, args: &[&str]) -> Result<Vec<String>, WorkspaceError> {
    let (output, _) = run_git(repo, args, MAX_GIT_OUTPUT_BYTES).await?;
    Ok(String::from_utf8(output)
        .map_err(|_| WorkspaceError::InvalidPath)?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

async fn optional_git_line(repo: &Path, args: &[&str]) -> Result<Option<String>, WorkspaceError> {
    let lines = git_lines(repo, args).await?;
    Ok(lines.into_iter().next())
}

pub(super) async fn run_git(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(repo)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child.stdout.take().ok_or(WorkspaceError::InvalidPath)?;
    let stderr = child.stderr.take().ok_or(WorkspaceError::InvalidPath)?;
    let stdout_task = async {
        let mut bytes = Vec::new();
        stdout
            .take((max_bytes + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        Ok::<_, std::io::Error>(bytes)
    };
    let stderr_task = async {
        let mut bytes = Vec::new();
        stderr.take(64 * 1024).read_to_end(&mut bytes).await?;
        Ok::<_, std::io::Error>(bytes)
    };
    let (mut output, _) = tokio::try_join!(stdout_task, stderr_task)?;
    let status = child.wait().await?;
    if !status.success() {
        return Err(WorkspaceError::InvalidPath);
    }
    let truncated = output.len() > max_bytes;
    output.truncate(max_bytes);
    Ok((output, truncated))
}
