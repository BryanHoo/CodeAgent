use std::{
    env,
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use thiserror::Error;
use tokio::{
    io::{self, AsyncRead, AsyncReadExt},
    process::{Child, Command},
    task::JoinHandle,
    time::timeout,
};

use super::connection::{AppServerConnection, ConnectionError};

const CODEX_BINARY_ENV: &str = "CODEAGENT_CODEX_BIN";
pub const SUPPORTED_CODEX_VERSION: &str = "0.149.0";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const VERSION_OUTPUT_LIMIT: usize = 4 * 1024;

#[derive(Debug, Error)]
pub enum ProcessError {
    #[error("failed to spawn codex app-server")]
    Spawn(#[source] std::io::Error),
    #[error("compatible Codex binary was not found")]
    BinaryNotFound,
    #[error("CODEAGENT_CODEX_BIN must be an absolute executable path")]
    InvalidBinaryPath,
    #[error("failed to probe Codex version")]
    VersionProbe(#[source] std::io::Error),
    #[error("Codex version probe timed out")]
    VersionProbeTimeout,
    #[error("Codex version output exceeded the limit")]
    VersionOutputTooLarge,
    #[error("unsupported Codex version; expected 0.149.0")]
    UnsupportedVersion,
    #[error("codex app-server did not expose required stdio pipes")]
    MissingPipe,
    #[error("codex app-server handshake failed")]
    Handshake(#[source] ConnectionError),
    #[error("codex app-server returned incomplete runtime metadata")]
    InvalidMetadata,
}

pub struct CodexProcess {
    _child: Child,
    binary_path: PathBuf,
    connection: Arc<AppServerConnection>,
    codex_home: PathBuf,
    stderr_task: JoinHandle<()>,
    version: String,
}

impl CodexProcess {
    pub async fn start() -> Result<Self, ProcessError> {
        let program = configured_binary()?;
        let version = probe_codex_version(&program).await?;
        let mut child = build_app_server_command(program.as_os_str())
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

        let codex_home = PathBuf::from(&metadata.codex_home);
        if metadata.user_agent.is_empty()
            || !codex_home.is_absolute()
            || metadata.platform_family.is_empty()
            || metadata.platform_os.is_empty()
        {
            return Err(ProcessError::InvalidMetadata);
        }

        Ok(Self {
            _child: child,
            binary_path: program,
            connection,
            codex_home,
            stderr_task,
            version,
        })
    }

    pub fn connection(&self) -> Arc<AppServerConnection> {
        Arc::clone(&self.connection)
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn codex_home(&self) -> &Path {
        &self.codex_home
    }

    #[allow(dead_code)]
    pub fn binary_path(&self) -> &Path {
        &self.binary_path
    }
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        self.stderr_task.abort();
    }
}

fn configured_binary() -> Result<PathBuf, ProcessError> {
    if let Some(explicit) = env::var_os(CODEX_BINARY_ENV) {
        let path = PathBuf::from(explicit);
        if !path.is_absolute() {
            return Err(ProcessError::InvalidBinaryPath);
        }
        return executable_path(&path).ok_or(ProcessError::InvalidBinaryPath);
    }
    let executable = OsString::from(format!("codex{}", env::consts::EXE_SUFFIX));
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            if let Some(path) = executable_path(&directory.join(&executable)) {
                return Ok(path);
            }
        }
    }
    for candidate in common_binary_paths(&executable) {
        if let Some(path) = executable_path(&candidate) {
            return Ok(path);
        }
    }
    Err(ProcessError::BinaryNotFound)
}

fn executable_path(path: &Path) -> Option<PathBuf> {
    let canonical = path.canonicalize().ok()?;
    let metadata = canonical.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }
    Some(canonical)
}

fn common_binary_paths(executable: &OsStr) -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin").join(executable),
        PathBuf::from("/usr/local/bin").join(executable),
        PathBuf::from("/usr/bin").join(executable),
    ];
    if let Some(home) = env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".local/bin").join(executable));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        paths.push(
            PathBuf::from(local_app_data)
                .join("Programs/Codex")
                .join(executable),
        );
    }
    paths
}

async fn probe_codex_version(program: &Path) -> Result<String, ProcessError> {
    let mut child = Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(ProcessError::VersionProbe)?;
    let stdout = child.stdout.take().ok_or(ProcessError::MissingPipe)?;
    let stderr = child.stderr.take().ok_or(ProcessError::MissingPipe)?;
    let result = timeout(VERSION_PROBE_TIMEOUT, async {
        tokio::try_join!(
            child.wait(),
            read_limited(stdout, VERSION_OUTPUT_LIMIT),
            read_limited(stderr, VERSION_OUTPUT_LIMIT)
        )
    })
    .await;
    let (status, stdout, _stderr) = match result {
        Ok(result) => result.map_err(ProcessError::VersionProbe)?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(ProcessError::VersionProbeTimeout);
        }
    };
    if !status.success() {
        return Err(ProcessError::UnsupportedVersion);
    }
    let output = std::str::from_utf8(&stdout).map_err(|_| ProcessError::UnsupportedVersion)?;
    parse_codex_version(output)
        .map(str::to_owned)
        .ok_or(ProcessError::UnsupportedVersion)
}

async fn read_limited<R: AsyncRead + Unpin>(reader: R, limit: usize) -> Result<Vec<u8>, io::Error> {
    let mut output = Vec::with_capacity(limit.min(256));
    reader
        .take(u64::try_from(limit).unwrap_or(u64::MAX) + 1)
        .read_to_end(&mut output)
        .await?;
    if output.len() > limit {
        return Err(io::Error::other(ProcessError::VersionOutputTooLarge));
    }
    Ok(output)
}

fn parse_codex_version(output: &str) -> Option<&str> {
    let mut parts = output.trim().split_ascii_whitespace();
    match (parts.next(), parts.next(), parts.next()) {
        (Some("codex-cli"), Some(SUPPORTED_CODEX_VERSION), None) => Some(SUPPORTED_CODEX_VERSION),
        _ => None,
    }
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
    use std::time::Duration;

    use serde_json::{Value, json};

    use super::{
        CodexProcess, SUPPORTED_CODEX_VERSION, build_app_server_command, parse_codex_version,
    };
    use crate::infrastructure::codex::{catalogs, conversation_commands, tasks};

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

    #[test]
    fn codex_version_should_require_the_exact_supported_cli_output() {
        assert_eq!(
            parse_codex_version("codex-cli 0.149.0\n"),
            Some(SUPPORTED_CODEX_VERSION)
        );
        assert_eq!(parse_codex_version("codex-cli 0.148.0\n"), None);
        assert_eq!(parse_codex_version("codex-cli 0.149.0 unexpected\n"), None);
    }

    #[tokio::test]
    #[ignore = "requires the installed codex-cli 0.149.0 binary"]
    async fn installed_codex_should_complete_real_app_server_lifecycle() {
        let process = CodexProcess::start()
            .await
            .expect("installed Codex app-server should start");
        assert_eq!(process.version(), SUPPORTED_CODEX_VERSION);
        let connection = process.connection();

        let models: Value = connection
            .request(
                "model/list",
                &json!({"cursor": null, "limit": 1}),
                Duration::from_secs(10),
            )
            .await
            .expect("model catalog should be readable");
        assert!(
            models["data"]
                .as_array()
                .is_some_and(|data| !data.is_empty())
        );

        let cwd = std::env::current_dir().expect("current directory should exist");
        let started: Value = connection
            .request(
                "thread/start",
                &json!({
                    "cwd": cwd,
                    "ephemeral": true,
                    "historyMode": "paginated",
                    "projectId": null,
                    "runtimeWorkspaceRoots": [],
                }),
                Duration::from_secs(10),
            )
            .await
            .expect("ephemeral thread should start");
        let thread_id = started["thread"]["id"]
            .as_str()
            .expect("thread/start should return an id");
        let read: Value = connection
            .request(
                "thread/read",
                &json!({"includeTurns": false, "threadId": thread_id}),
                Duration::from_secs(10),
            )
            .await
            .expect("ephemeral thread should be readable");
        assert_eq!(read["thread"]["id"], thread_id);

        let mapped_models = catalogs::list_models(&connection)
            .await
            .expect("native model mapping should match the installed server");
        assert!(
            mapped_models["data"]
                .as_array()
                .is_some_and(|data| !data.is_empty())
        );
        let mapped_skills = catalogs::list_skills(&connection, &cwd.to_string_lossy(), false)
            .await
            .expect("native skill mapping should match the installed server");
        assert!(mapped_skills["data"].is_array());

        // 使用产品真实命令创建并立即删除临时任务，验证持久化生命周期参数。
        let task = conversation_commands::start_task(&connection, "temporary".to_owned())
            .await
            .expect("CodeAgent temporary task should start");
        let deleted = tasks::delete_task(&connection, "temporary".to_owned(), task.task.id)
            .await
            .expect("CodeAgent temporary task should be removable");
        assert_eq!(deleted.status, "deleted");
    }
}
