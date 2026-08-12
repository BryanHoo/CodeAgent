//! Codex App Server 子进程生命周期：spawn、握手、stderr 环形缓冲、退出监视与关闭升级。

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use serde_json::json;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::binary::{CodexVersionInfo, check_codex_version};
use crate::rpc::{JsonlRpcClient, JsonlRpcClientOptions, RpcClientError, RpcIncoming, RpcWorkers};

const APP_SERVER_ARGUMENTS: [&str; 3] = ["app-server", "--listen", "stdio://"];
const MAX_STDERR_BYTES: usize = 8_192;

/// Codex App Server 启动选项。
#[derive(Clone, Debug)]
pub struct CodexAppServerOptions {
    pub app_version: String,
    pub binary_path: PathBuf,
    pub cwd: Option<PathBuf>,
    pub env_overrides: Vec<(String, String)>,
    pub rpc: JsonlRpcClientOptions,
    pub shutdown_timeout: Duration,
}

impl Default for CodexAppServerOptions {
    fn default() -> Self {
        Self {
            app_version: "0.0.0".to_string(),
            binary_path: PathBuf::new(),
            cwd: None,
            env_overrides: Vec::new(),
            rpc: JsonlRpcClientOptions::default(),
            shutdown_timeout: Duration::from_secs(2),
        }
    }
}

/// 子进程退出信息。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CodexProcessExit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

enum SupervisorCommand {
    Terminate,
    Kill,
}

/// 运行中的 Codex App Server。
pub struct CodexAppServerProcess {
    client: JsonlRpcClient,
    close_done: tokio::sync::Mutex<bool>,
    closing: Arc<AtomicBool>,
    control_tx: mpsc::Sender<SupervisorCommand>,
    exit_rx: watch::Receiver<Option<CodexProcessExit>>,
    incoming: Mutex<Option<RpcIncoming>>,
    shutdown_timeout: Duration,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    version: CodexVersionInfo,
    workers: Mutex<Option<RpcWorkers>>,
}

impl CodexAppServerProcess {
    /// 返回 RPC 客户端。
    #[must_use]
    pub fn client(&self) -> &JsonlRpcClient {
        &self.client
    }

    /// 返回已确认的 Codex 版本。
    #[must_use]
    pub fn version(&self) -> &CodexVersionInfo {
        &self.version
    }

    /// 取出入站流（通知、服务端请求、错误）；只能取一次。
    #[must_use]
    pub fn take_incoming(&self) -> Option<RpcIncoming> {
        self.incoming.lock().ok().and_then(|mut slot| slot.take())
    }

    /// 返回 stderr 尾部内容（最多 8 KiB）。
    #[must_use]
    pub fn stderr_tail(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|tail| String::from_utf8_lossy(&tail).trim().to_string())
            .unwrap_or_default()
    }

    /// 等待子进程退出。
    pub async fn wait_for_exit(&self) -> CodexProcessExit {
        let mut receiver = self.exit_rx.clone();
        loop {
            let current = *receiver.borrow();
            if let Some(exit) = current {
                return exit;
            }
            if receiver.changed().await.is_err() {
                return CodexProcessExit {
                    code: None,
                    signal: None,
                };
            }
        }
    }

    /// 幂等关闭：stdin 关闭 → SIGTERM → SIGKILL，每级等待 `shutdown_timeout`。
    pub async fn close(&self) -> Result<(), CodeAgentError> {
        let mut done = self.close_done.lock().await;
        if *done {
            return Ok(());
        }
        self.closing.store(true, Ordering::SeqCst);
        // 关闭客户端会取消写任务并丢弃 stdin，向子进程请求正常退出。
        self.client.close(Some(RpcClientError::ConnectionClosed(
            "Codex App Server is closing".to_string(),
        )));

        let result = self.escalate().await;
        if result.is_ok() {
            *done = true;
        }

        let workers = self.workers.lock().ok().and_then(|mut slot| slot.take());
        if let Some(workers) = workers {
            workers.join().await;
        }
        let tasks = self
            .tasks
            .lock()
            .map(|mut tasks| tasks.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();
        for task in tasks {
            let _ = task.await;
        }
        result
    }

    async fn escalate(&self) -> Result<(), CodeAgentError> {
        if self.exit_within(self.shutdown_timeout).await {
            return Ok(());
        }
        let _ = self.control_tx.send(SupervisorCommand::Terminate).await;
        if self.exit_within(self.shutdown_timeout).await {
            return Ok(());
        }
        let _ = self.control_tx.send(SupervisorCommand::Kill).await;
        if self.exit_within(self.shutdown_timeout).await {
            return Ok(());
        }
        Err(CodeAgentError::new(
            CodeAgentErrorCode::Timeout,
            format!(
                "Codex App Server did not exit within {}ms after SIGKILL",
                self.shutdown_timeout.as_millis()
            ),
            None,
        ))
    }

    async fn exit_within(&self, timeout: Duration) -> bool {
        tokio::time::timeout(timeout, self.wait_for_exit())
            .await
            .is_ok()
    }
}

fn provider_failure(message: String) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::ProviderFailure, message, None)
}

/// 将 RPC 错误映射为稳定领域错误码。
#[must_use]
pub fn rpc_error_to_code_agent_error(error: &RpcClientError) -> CodeAgentError {
    match error {
        RpcClientError::Timeout { .. } => {
            CodeAgentError::new(CodeAgentErrorCode::Timeout, error.to_string(), None)
        }
        RpcClientError::Response { message, .. } => {
            provider_failure(format!("Codex request failed: {message}"))
        }
        RpcClientError::ConnectionClosed(_) | RpcClientError::Protocol(_) => {
            provider_failure(error.to_string())
        }
    }
}

fn append_stderr_tail(tail: &Mutex<Vec<u8>>, data: &[u8]) {
    if let Ok(mut tail) = tail.lock() {
        tail.extend_from_slice(data);
        if tail.len() > MAX_STDERR_BYTES {
            let excess = tail.len() - MAX_STDERR_BYTES;
            tail.drain(..excess);
        }
    }
}

#[cfg(unix)]
fn send_terminate_signal(child: &tokio::process::Child) {
    if let Some(pid) = child.id() {
        // SIGTERM 请求优雅退出；失败时由后续 SIGKILL 兜底。
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGTERM,
        );
    }
}

#[cfg(not(unix))]
fn send_terminate_signal(child: &tokio::process::Child) {
    // Windows 无 SIGTERM 等价语义，直接进入强制终止。
    let _ = child.id();
}

fn exit_from_status(status: std::process::ExitStatus) -> CodexProcessExit {
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        status.signal()
    };
    #[cfg(not(unix))]
    let signal = None;
    CodexProcessExit {
        code: status.code(),
        signal,
    }
}

async fn run_supervisor(
    mut child: tokio::process::Child,
    exit_tx: watch::Sender<Option<CodexProcessExit>>,
    mut control_rx: mpsc::Receiver<SupervisorCommand>,
    client: JsonlRpcClient,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
    closing: Arc<AtomicBool>,
) {
    let mut control_closed = false;
    loop {
        tokio::select! {
            status = child.wait() => {
                let exit = status.map(exit_from_status).unwrap_or(CodexProcessExit {
                    code: None,
                    signal: None,
                });
                if !closing.load(Ordering::SeqCst) {
                    let reason = exit.signal.map_or_else(
                        || format!("code {}", exit.code.map_or_else(|| "unknown".to_string(), |code| code.to_string())),
                        |signal| format!("signal {signal}"),
                    );
                    let tail = stderr_tail
                        .lock()
                        .map(|tail| String::from_utf8_lossy(&tail).trim().to_string())
                        .unwrap_or_default();
                    let detail = if tail.is_empty() {
                        String::new()
                    } else {
                        format!(": {tail}")
                    };
                    client.close(Some(RpcClientError::ConnectionClosed(format!(
                        "Codex App Server exited unexpectedly with {reason}{detail}"
                    ))));
                }
                let _ = exit_tx.send(Some(exit));
                break;
            }
            command = control_rx.recv(), if !control_closed => {
                match command {
                    Some(SupervisorCommand::Terminate) => send_terminate_signal(&child),
                    Some(SupervisorCommand::Kill) => {
                        let _ = child.start_kill();
                    }
                    None => control_closed = true,
                }
            }
        }
    }
}

/// 启动 Codex App Server 并完成 `initialize` 握手。
pub async fn start_codex_app_server(
    options: CodexAppServerOptions,
) -> Result<CodexAppServerProcess, CodeAgentError> {
    let version = check_codex_version(&options.binary_path, &options.env_overrides).await?;

    let mut command = tokio::process::Command::new(&options.binary_path);
    command
        .args(APP_SERVER_ARGUMENTS)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &options.cwd {
        command.current_dir(cwd);
    }
    for (key, value) in &options.env_overrides {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW：Desktop 后台进程不允许弹出控制台窗口。
        command.creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| provider_failure(format!("Failed to start Codex App Server: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| provider_failure("Codex App Server stdout is unavailable".to_string()))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| provider_failure("Codex App Server stdin is unavailable".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| provider_failure("Codex App Server stderr is unavailable".to_string()))?;

    // 进程退出由 supervisor 统一转换为关闭原因，读取端不再单独关闭客户端。
    let rpc_options = JsonlRpcClientOptions {
        close_on_input_end: false,
        ..options.rpc
    };
    let (client, incoming, workers) = JsonlRpcClient::spawn(stdout, stdin, rpc_options);

    let stderr_tail = Arc::new(Mutex::new(Vec::new()));
    let stderr_task = {
        let stderr_tail = Arc::clone(&stderr_tail);
        let mut stderr = stderr;
        tokio::spawn(async move {
            let mut chunk = vec![0_u8; 4_096];
            loop {
                match stderr.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(read) => append_stderr_tail(&stderr_tail, &chunk[..read]),
                }
            }
        })
    };

    let closing = Arc::new(AtomicBool::new(false));
    let (control_tx, control_rx) = mpsc::channel(4);
    let (exit_tx, exit_rx) = watch::channel(None);
    let supervisor_task = tokio::spawn(run_supervisor(
        child,
        exit_tx,
        control_rx,
        client.clone(),
        Arc::clone(&stderr_tail),
        Arc::clone(&closing),
    ));

    let process = CodexAppServerProcess {
        client,
        close_done: tokio::sync::Mutex::new(false),
        closing,
        control_tx,
        exit_rx,
        incoming: Mutex::new(Some(incoming)),
        shutdown_timeout: options.shutdown_timeout,
        stderr_tail,
        tasks: Mutex::new(vec![stderr_task, supervisor_task]),
        version,
        workers: Mutex::new(Some(workers)),
    };

    let handshake = process
        .client()
        .request(
            "initialize",
            Some(json!({
                "capabilities": { "experimentalApi": true },
                "clientInfo": {
                    "name": "code_agent",
                    "title": "CodeAgent",
                    "version": options.app_version,
                }
            })),
        )
        .await;
    match handshake {
        Ok(_) => {
            let _ = process
                .client()
                .notify("initialized", Some(json!({})))
                .await;
            Ok(process)
        }
        Err(error) => {
            let _ = process.close().await;
            Err(rpc_error_to_code_agent_error(&error))
        }
    }
}
