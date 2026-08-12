use std::{
    path::Path,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode, PortRequestContext};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};

const MAX_OUTPUT_BYTES: usize = 10 * 1024 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(10);

pub struct ProcessOutput {
    pub stdout: Vec<u8>,
}

pub async fn execute_git(
    root: &Path,
    arguments: &[String],
    stdin: Option<&[u8]>,
    context: &PortRequestContext,
) -> Result<ProcessOutput, CodeAgentError> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(arguments)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in [
        "GIT_ASKPASS",
        "GIT_CONFIG",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_EDITOR",
        "GIT_EXEC_PATH",
        "GIT_EXTERNAL_DIFF",
        "GIT_PAGER",
        "GIT_PROXY_COMMAND",
        "GIT_SEQUENCE_EDITOR",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "GIT_TEMPLATE_DIR",
        "PAGER",
        "SSH_ASKPASS",
    ] {
        command.env_remove(key);
    }
    command.env("GIT_OPTIONAL_LOCKS", "0");
    let mut child = command
        .spawn()
        .map_err(|_| failure("git command could not start"))?;
    if let Some(input) = stdin {
        let mut writer = child
            .stdin
            .take()
            .ok_or_else(|| failure("git stdin is unavailable"))?;
        writer
            .write_all(input)
            .await
            .map_err(|_| failure("git stdin failed"))?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("git stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| failure("git stderr is unavailable"))?;
    let budget = Arc::new(AtomicUsize::new(0));
    let stdout_task = tokio::spawn(read_bounded(stdout, budget.clone()));
    let stderr_task = tokio::spawn(read_bounded(stderr, budget));
    let status = tokio::select! {
        status = child.wait() => status.map_err(|_| failure("git command failed"))?,
        () = context.cancelled() => {
            let _ = child.kill().await;
            return Err(CodeAgentError::new(CodeAgentErrorCode::Cancelled, "operation was cancelled", None));
        }
        () = tokio::time::sleep(PROCESS_TIMEOUT) => {
            let _ = child.kill().await;
            return Err(CodeAgentError::new(CodeAgentErrorCode::Timeout, "git command timed out", None));
        }
    };
    let stdout = stdout_task
        .await
        .map_err(|_| failure("git output task failed"))??;
    let stderr = stderr_task
        .await
        .map_err(|_| failure("git output task failed"))??;
    if !status.success() {
        let message = String::from_utf8_lossy(&stderr);
        return Err(failure(if message.is_empty() {
            "git command failed"
        } else {
            "git command was rejected"
        }));
    }
    Ok(ProcessOutput { stdout })
}

async fn read_bounded(
    mut reader: impl AsyncRead + Unpin,
    budget: Arc<AtomicUsize>,
) -> Result<Vec<u8>, CodeAgentError> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|_| failure("git output failed"))?;
        if read == 0 {
            return Ok(output);
        }
        let previous = budget.fetch_add(read, Ordering::AcqRel);
        if previous.saturating_add(read) > MAX_OUTPUT_BYTES {
            return Err(capacity("git command output exceeded the limit"));
        }
        output.extend_from_slice(&buffer[..read]);
    }
}

fn failure(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::ProviderFailure, message, None)
}

fn capacity(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::CapacityExceeded, message, None)
}
