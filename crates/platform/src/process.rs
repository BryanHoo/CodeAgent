use std::{
    ffi::{OsStr, OsString},
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

#[derive(Clone, Debug)]
pub struct ProcessEnvironment {
    variables: Arc<[(OsString, OsString)]>,
}

impl ProcessEnvironment {
    #[must_use]
    pub fn capture_with_path(path: OsString) -> Self {
        // Composition Root 只覆盖工具搜索路径，其余宿主变量保持启动时快照。
        let variables = std::env::vars_os()
            .filter(|(key, _)| !environment_key_matches(key, "PATH"))
            .chain(std::iter::once((OsString::from("PATH"), path)));
        Self::from_variables(variables)
    }

    #[must_use]
    pub fn from_variables<K, V>(variables: impl IntoIterator<Item = (K, V)>) -> Self
    where
        K: Into<OsString>,
        V: Into<OsString>,
    {
        Self {
            variables: variables
                .into_iter()
                .map(|(key, value)| (key.into(), value.into()))
                .collect(),
        }
    }

    pub(crate) fn apply(&self, command: &mut Command) {
        // 清空继承环境后应用快照，避免调用期间的进程环境变化绕过注入边界。
        command
            .env_clear()
            .envs(self.variables.iter().map(|(key, value)| (key, value)));
    }

    pub(crate) fn utf8_variables(&self) -> impl Iterator<Item = (&str, &str)> {
        self.variables
            .iter()
            .filter_map(|(key, value)| Some((key.to_str()?, value.to_str()?)))
    }
}

fn environment_key_matches(key: &OsStr, expected: &str) -> bool {
    key.to_string_lossy().eq_ignore_ascii_case(expected)
}

pub async fn execute_git(
    root: &Path,
    arguments: &[String],
    stdin: Option<&[u8]>,
    environment: &ProcessEnvironment,
    context: &PortRequestContext,
) -> Result<ProcessOutput, CodeAgentError> {
    let mut command = Command::new("git");
    environment.apply(&mut command);
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

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use code_agent_core::PortRequestContext;

    use super::{ProcessEnvironment, execute_git};

    #[tokio::test]
    async fn execute_git_uses_injected_path_and_removes_dangerous_variables() {
        let root = std::env::temp_dir().join(format!(
            "code-agent-git-environment-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create Git environment fixture");
        let executable = root.join("git");
        fs::write(
            &executable,
            "#!/bin/sh\n[ -z \"${GIT_CONFIG_COUNT+x}\" ] || exit 99\n[ -z \"${GIT_EXEC_PATH+x}\" ] || exit 99\n[ -z \"${GIT_EXTERNAL_DIFF+x}\" ] || exit 99\n[ -z \"${GIT_SSH_COMMAND+x}\" ] || exit 99\n[ -z \"${GIT_ASKPASS+x}\" ] || exit 99\nprintf '%s\\n' \"$CODE_AGENT_TEST_MARKER\"\n",
        )
        .expect("write fake Git executable");
        let mut permissions = fs::metadata(&executable)
            .expect("read fake Git metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).expect("make fake Git executable");
        let environment = ProcessEnvironment::from_variables([
            ("PATH", root.to_string_lossy().as_ref()),
            ("CODE_AGENT_TEST_MARKER", "injected"),
            ("GIT_CONFIG_COUNT", "1"),
            ("GIT_EXEC_PATH", "/unsafe/git-core"),
            ("GIT_EXTERNAL_DIFF", "unsafe-diff"),
            ("GIT_SSH_COMMAND", "unsafe-ssh"),
            ("GIT_ASKPASS", "unsafe-askpass"),
        ]);

        let output = execute_git(
            &root,
            &[],
            None,
            &environment,
            &PortRequestContext::new("git-environment-test"),
        )
        .await
        .expect("execute injected Git");

        fs::remove_dir_all(&root).expect("remove Git environment fixture");
        assert_eq!(output.stdout, b"injected\n");
    }
}
