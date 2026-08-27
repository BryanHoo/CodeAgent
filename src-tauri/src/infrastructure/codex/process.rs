use std::{
    env,
    ffi::{OsStr, OsString},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use thiserror::Error;
use tokio::{
    io,
    process::{Child, Command},
    task::JoinHandle,
};

use super::connection::{AppServerConnection, ConnectionError};

const CODEX_BINARY_ENV: &str = "CODEAGENT_CODEX_BIN";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Error)]
pub enum ProcessError {
    #[error("failed to spawn codex app-server")]
    Spawn(#[source] std::io::Error),
    #[error("codex app-server did not expose required stdio pipes")]
    MissingPipe,
    #[error("codex app-server handshake failed")]
    Handshake(#[source] ConnectionError),
    #[error("codex app-server returned incomplete runtime metadata")]
    InvalidMetadata,
}

pub struct CodexProcess {
    _child: Child,
    connection: Arc<AppServerConnection>,
    stderr_task: JoinHandle<()>,
}

impl CodexProcess {
    pub async fn start() -> Result<Self, ProcessError> {
        let program = configured_binary();
        let mut child = build_app_server_command(&program)
            .spawn()
            .map_err(ProcessError::Spawn)?;
        let stdin = child.stdin.take().ok_or(ProcessError::MissingPipe)?;
        let stdout = child.stdout.take().ok_or(ProcessError::MissingPipe)?;
        let mut stderr = child.stderr.take().ok_or(ProcessError::MissingPipe)?;

        // stderr 必须独立持续排水，避免日志写满管道后阻塞协议进程。
        let stderr_task = tokio::spawn(async move {
            let _ = io::copy(&mut stderr, &mut io::sink()).await;
        });
        let connection = Arc::new(AppServerConnection::new(stdout, stdin));
        let metadata = connection
            .initialize(STARTUP_TIMEOUT)
            .await
            .map_err(ProcessError::Handshake)?;

        if metadata.user_agent.is_empty()
            || metadata.codex_home.is_empty()
            || metadata.platform_family.is_empty()
            || metadata.platform_os.is_empty()
        {
            return Err(ProcessError::InvalidMetadata);
        }

        Ok(Self {
            _child: child,
            connection,
            stderr_task,
        })
    }

    pub fn connection(&self) -> Arc<AppServerConnection> {
        Arc::clone(&self.connection)
    }
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        self.stderr_task.abort();
    }
}

fn configured_binary() -> OsString {
    env::var_os(CODEX_BINARY_ENV).unwrap_or_else(|| OsString::from("codex"))
}

fn build_app_server_command(program: &OsStr) -> Command {
    let mut command = Command::new(program);
    // 不设置 CODEX_HOME，让官方逻辑继承用户配置或回退到默认 ~/.codex。
    command
        .args(["app-server", "--listen", "stdio://"])
        .env("LOG_FORMAT", "json")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::build_app_server_command;

    #[test]
    fn command_should_use_stdio_and_inherit_official_codex_home() {
        let command = build_app_server_command(OsStr::new("codex-test"));
        let command = command.as_std();

        assert_eq!(command.get_program(), "codex-test");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            ["app-server", "--listen", "stdio://"]
        );
        assert!(command.get_envs().all(|(key, _)| key != "CODEX_HOME"));
    }
}
