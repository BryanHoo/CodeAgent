use std::{
    collections::VecDeque,
    env,
    path::{Path, PathBuf},
    process::ExitStatus,
    sync::OnceLock,
    time::Duration,
};

use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    sync::mpsc,
    time::{Instant, sleep_until},
};

use super::path_guard::WorkspaceError;

const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30);
const NETWORK_GIT_TIMEOUT: Duration = Duration::from_secs(120);
const STDERR_CAPTURE_BYTES: usize = 64 * 1024;
const READ_BUFFER_BYTES: usize = 16 * 1024;
const GIT_BINARY_ENV: &str = "CODEAGENT_GIT_BIN";
static GIT_BINARY_PATH: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone, Copy)]
enum StopReason {
    StdoutLimit,
    StderrLimit,
    Timeout,
}

enum ProcessOutcome {
    Exited(ExitStatus),
    Stopped(StopReason),
}

enum ProcessEvent {
    LimitExceeded(StopReason),
    TaskFinished,
}

struct BoundedCapture {
    head: Vec<u8>,
    tail: VecDeque<u8>,
    head_limit: usize,
    tail_limit: usize,
    total_bytes: usize,
}

impl BoundedCapture {
    fn new(limit: usize) -> Self {
        let head_limit = limit.div_ceil(2);
        Self {
            head: Vec::with_capacity(head_limit),
            tail: VecDeque::with_capacity(limit - head_limit),
            head_limit,
            tail_limit: limit - head_limit,
            total_bytes: 0,
        }
    }

    fn push(&mut self, mut bytes: &[u8]) -> bool {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len());
        let head_remaining = self.head_limit - self.head.len();
        let head_bytes = head_remaining.min(bytes.len());
        self.head.extend_from_slice(&bytes[..head_bytes]);
        bytes = &bytes[head_bytes..];

        if self.tail_limit > 0 {
            if bytes.len() >= self.tail_limit {
                self.tail.clear();
                self.tail.extend(&bytes[bytes.len() - self.tail_limit..]);
            } else {
                let overflow = self
                    .tail
                    .len()
                    .saturating_add(bytes.len())
                    .saturating_sub(self.tail_limit);
                self.tail.drain(..overflow);
                self.tail.extend(bytes);
            }
        }
        self.is_truncated()
    }

    fn is_truncated(&self) -> bool {
        self.total_bytes > self.head_limit + self.tail_limit
    }

    fn into_bytes(self) -> Vec<u8> {
        let mut bytes = self.head;
        bytes.reserve(self.tail.len());
        bytes.extend(self.tail);
        bytes
    }
}

pub(super) async fn run_git(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    run_git_command(repo, args, max_bytes, None, None, LOCAL_GIT_TIMEOUT).await
}

pub(super) async fn run_network_git(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    run_git_command(repo, args, max_bytes, None, None, NETWORK_GIT_TIMEOUT).await
}

pub(super) async fn run_git_with_index(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
    index_path: &Path,
    input: Option<&[u8]>,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    run_git_command(
        repo,
        args,
        max_bytes,
        Some(index_path),
        input,
        LOCAL_GIT_TIMEOUT,
    )
    .await
}

async fn run_git_command(
    repo: &Path,
    args: &[&str],
    max_bytes: usize,
    index_path: Option<&Path>,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<(Vec<u8>, bool), WorkspaceError> {
    let mut command = Command::new(git_binary_path()?);
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
    // Git 可能启动 hook、ssh 等后代进程，统一进程组才能在超限或超时时关闭整棵进程树。
    #[cfg(unix)]
    command.process_group(0);
    if let Some(index_path) = index_path {
        command.env("GIT_INDEX_FILE", index_path);
    }

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            WorkspaceError::GitNotFound
        } else {
            WorkspaceError::Io(error)
        }
    })?;
    let process_id = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or(WorkspaceError::InvalidPath)?;
    let stderr = child.stderr.take().ok_or(WorkspaceError::InvalidPath)?;
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let stdout_task = drain_stream(stdout, max_bytes, StopReason::StdoutLimit, event_tx.clone());
    let stderr_task = drain_stream(
        stderr,
        STDERR_CAPTURE_BYTES,
        StopReason::StderrLimit,
        event_tx.clone(),
    );
    let input_task = async {
        let result = async {
            if let (Some(mut stdin), Some(input)) = (stdin, input) {
                stdin.write_all(input).await?;
                stdin.shutdown().await?;
            }
            Ok::<_, std::io::Error>(())
        }
        .await;
        let _ = event_tx.send(ProcessEvent::TaskFinished);
        result
    };
    let wait_task = wait_for_child(&mut child, process_id, event_rx, timeout);

    // 四个 future 必须同时推进，避免任一管道或 stdin 反向阻塞 Git。
    let (input_result, stdout_result, stderr_result, outcome_result) =
        tokio::join!(input_task, stdout_task, stderr_task, wait_task);
    let outcome = outcome_result?;
    let stdout = stdout_result?;
    let stderr = stderr_result?;
    if !matches!(outcome, ProcessOutcome::Stopped(_)) {
        input_result?;
    }

    let stdout_truncated = stdout.is_truncated();
    let output = stdout.into_bytes();
    let stderr = stderr.into_bytes();
    match outcome {
        ProcessOutcome::Stopped(StopReason::StdoutLimit) => return Ok((output, true)),
        ProcessOutcome::Stopped(StopReason::StderrLimit) => {
            return Err(git_failure(
                args,
                format!("output exceeded {STDERR_CAPTURE_BYTES} bytes"),
                &stderr,
            ));
        }
        ProcessOutcome::Stopped(StopReason::Timeout) => {
            return Err(git_failure(
                args,
                format!("timed out after {} seconds", timeout.as_secs()),
                &stderr,
            ));
        }
        ProcessOutcome::Exited(status) if !status.success() => {
            let detail = String::from_utf8_lossy(&stderr);
            if detail.contains("has no upstream branch") {
                return Err(WorkspaceError::NoUpstream);
            }
            let fallback = format!("failed with {status}");
            return Err(git_failure(args, fallback, &stderr));
        }
        ProcessOutcome::Exited(_) => {}
    }
    Ok((output, stdout_truncated))
}

fn git_binary_path() -> Result<&'static Path, WorkspaceError> {
    if let Some(path) = GIT_BINARY_PATH.get() {
        return Ok(path);
    }
    let path = discover_git_binary().ok_or(WorkspaceError::GitNotFound)?;
    let _ = GIT_BINARY_PATH.set(path);
    GIT_BINARY_PATH
        .get()
        .map(PathBuf::as_path)
        .ok_or(WorkspaceError::GitNotFound)
}

fn discover_git_binary() -> Option<PathBuf> {
    let executable = format!("git{}", env::consts::EXE_SUFFIX);
    let mut candidates = Vec::new();

    if let Some(explicit) = env::var_os(GIT_BINARY_ENV) {
        let explicit = PathBuf::from(explicit);
        if explicit.is_absolute() {
            candidates.push(explicit);
        }
    }
    if let Some(paths) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&paths).map(|directory| directory.join(&executable)));
    }
    candidates.extend(common_git_paths(&executable));

    // GUI 进程的 PATH 可能落后于安装器写入值，平台常见目录作为低成本回退。
    first_existing_path(candidates)
}

fn first_existing_path(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn common_git_paths(executable: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = env::var_os(variable) {
            let root = PathBuf::from(root).join("Git");
            candidates.push(root.join("cmd").join(executable));
            candidates.push(root.join("bin").join(executable));
        }
    }
    if let Some(root) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(root)
                .join("Programs/Git/cmd")
                .join(executable),
        );
    }
    candidates
}

#[cfg(not(target_os = "windows"))]
fn common_git_paths(executable: &str) -> Vec<PathBuf> {
    ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]
        .into_iter()
        .map(|directory| Path::new(directory).join(executable))
        .collect()
}

async fn drain_stream<R>(
    mut reader: R,
    limit: usize,
    reason: StopReason,
    event_tx: mpsc::UnboundedSender<ProcessEvent>,
) -> std::io::Result<BoundedCapture>
where
    R: AsyncRead + Unpin,
{
    let mut capture = BoundedCapture::new(limit);
    // 读取缓冲区放到堆上，避免组合多个 Git future 时撑爆 WebView 宿主的工作线程栈。
    let mut buffer = vec![0_u8; READ_BUFFER_BYTES];
    let mut limit_reported = false;
    let result = async {
        loop {
            let read = reader.read(&mut buffer).await?;
            if read == 0 {
                return Ok(capture);
            }
            if capture.push(&buffer[..read]) && !limit_reported {
                let _ = event_tx.send(ProcessEvent::LimitExceeded(reason));
                limit_reported = true;
            }
        }
    }
    .await;
    let _ = event_tx.send(ProcessEvent::TaskFinished);
    result
}

async fn wait_for_child(
    child: &mut Child,
    process_id: Option<u32>,
    mut event_rx: mpsc::UnboundedReceiver<ProcessEvent>,
    timeout: Duration,
) -> std::io::Result<ProcessOutcome> {
    let deadline = sleep_until(Instant::now() + timeout);
    tokio::pin!(deadline);
    let mut status = None;
    let mut finished_tasks = 0;
    let mut watch_events = true;
    loop {
        if finished_tasks == 3
            && let Some(status) = status
        {
            return Ok(ProcessOutcome::Exited(status));
        }
        tokio::select! {
            result = child.wait(), if status.is_none() => status = Some(result?),
            event = event_rx.recv(), if watch_events => {
                match event {
                    Some(ProcessEvent::LimitExceeded(reason)) => {
                        terminate_child(child, process_id, status.is_some()).await?;
                        return Ok(ProcessOutcome::Stopped(reason));
                    }
                    Some(ProcessEvent::TaskFinished) => finished_tasks += 1,
                    None => watch_events = false,
                }
            }
            () = &mut deadline => {
                terminate_child(child, process_id, status.is_some()).await?;
                return Ok(ProcessOutcome::Stopped(StopReason::Timeout));
            }
        }
    }
}

#[cfg(unix)]
fn unix_kill_process_group_args(process_id: u32) -> [String; 3] {
    // GNU kill 需要显式结束选项解析，否则负 PGID 会被误判为第二个信号选项。
    [
        "-KILL".to_owned(),
        "--".to_owned(),
        format!("-{process_id}"),
    ]
}

async fn terminate_child(
    child: &mut Child,
    process_id: Option<u32>,
    child_exited: bool,
) -> std::io::Result<()> {
    #[cfg(unix)]
    if let Some(process_id) = process_id {
        let status = Command::new("/bin/kill")
            .args(unix_kill_process_group_args(process_id))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        if status.is_ok_and(|status| status.success()) {
            if !child_exited {
                child.wait().await?;
            }
            return Ok(());
        }
    }
    #[cfg(windows)]
    if let Some(process_id) = process_id {
        let status = Command::new("taskkill")
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        if status.is_ok_and(|status| status.success()) {
            if !child_exited {
                child.wait().await?;
            }
            return Ok(());
        }
    }
    if child_exited {
        return Ok(());
    }
    child.kill().await
}

fn git_failure(args: &[&str], fallback: String, stderr: &[u8]) -> WorkspaceError {
    let operation = args.first().copied().unwrap_or("command");
    let detail = String::from_utf8_lossy(stderr);
    let detail = detail.trim();
    let message = if detail.is_empty() {
        format!("git {operation} {fallback}")
    } else {
        format!("git {operation} {fallback}: {detail}")
    };
    WorkspaceError::GitCommandFailed(message)
}

#[cfg(test)]
mod tests {
    use std::{env, path::Path, time::Duration};

    use super::{
        BoundedCapture, LOCAL_GIT_TIMEOUT, NETWORK_GIT_TIMEOUT, first_existing_path,
        run_git_command, unix_kill_process_group_args,
    };

    #[test]
    fn bounded_capture_should_preserve_head_and_tail() {
        let mut capture = BoundedCapture::new(6);
        assert!(capture.push(b"0123456789"));
        assert_eq!(capture.into_bytes(), b"012789");
    }

    #[test]
    fn network_git_should_allow_more_time_than_local_git() {
        assert!(NETWORK_GIT_TIMEOUT > LOCAL_GIT_TIMEOUT);
    }

    #[test]
    fn git_discovery_should_select_the_first_existing_file() {
        let current_executable = env::current_exe().expect("test executable should exist");
        let missing = current_executable.join("missing-git");

        assert_eq!(
            first_existing_path([missing, current_executable.clone()]),
            Some(current_executable)
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_process_group_kill_should_terminate_option_parsing_before_negative_pgid() {
        assert_eq!(unix_kill_process_group_args(42), ["-KILL", "--", "-42"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_should_kill_git_descendants_holding_pipes() {
        let args = ["-c", "alias.hang=!sh -c 'sleep 60 &'", "hang"];
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            run_git_command(
                Path::new("/"),
                &args,
                1024,
                None,
                None,
                Duration::from_millis(100),
            ),
        )
        .await
        .expect("Git descendants should not outlive the timeout");

        assert!(result.is_err());
    }
}
