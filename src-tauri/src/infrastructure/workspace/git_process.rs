use std::path::Path;

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use super::path_guard::WorkspaceError;

pub(super) async fn run_git(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    run_git_command(repo, args, max_bytes, None, None).await
}

pub(super) async fn run_git_with_index(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
    index_path: &Path,
    input: Option<&[u8]>,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    run_git_command(repo, args, max_bytes, Some(index_path), input).await
}

async fn run_git_command(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
    index_path: Option<&Path>,
    input: Option<&[u8]>,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(repo)
        .env_remove("GIT_INDEX_FILE")
        .stdin(if input.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(index_path) = index_path {
        command.env("GIT_INDEX_FILE", index_path);
    }
    let mut child = command.spawn()?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or(WorkspaceError::InvalidPath)?;
    let stderr = child.stderr.take().ok_or(WorkspaceError::InvalidPath)?;
    let input_task = async {
        if let (Some(mut stdin), Some(input)) = (stdin, input) {
            stdin.write_all(input).await?;
            stdin.shutdown().await?;
        }
        Ok::<_, std::io::Error>(())
    };
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
    let (_, mut output, stderr) = tokio::try_join!(input_task, stdout_task, stderr_task)?;
    let status = child.wait().await?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        let detail = stderr.trim();
        if detail.contains("has no upstream branch") {
            return Err(WorkspaceError::NoUpstream);
        }
        let operation = args.first().copied().unwrap_or("command");
        let message = if detail.is_empty() {
            format!("git {operation} failed with {status}")
        } else {
            format!("git {operation} failed: {detail}")
        };
        return Err(WorkspaceError::GitCommandFailed(message));
    }
    let truncated = output.len() > max_bytes;
    output.truncate(max_bytes);
    Ok((output, truncated))
}
