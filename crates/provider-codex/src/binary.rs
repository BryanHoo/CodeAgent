//! Codex 可执行文件定位与版本校验。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};

/// 当前锁定支持的 Codex 版本；必须与 TypeScript `SUPPORTED_CODEX_VERSION` 保持一致。
pub const SUPPORTED_CODEX_VERSION: &str = "0.147.0";

const VERSION_CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// Codex 二进制来源，按优先级从高到低。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CodexBinarySource {
    /// 调用方显式指定的路径。
    Explicit,
    /// 来自 `CODE_AGENT_CODEX_BIN` 环境变量的路径。
    Environment,
    /// 调用方提供的候选路径（例如 Desktop sidecar 位置）。
    Candidate,
}

/// 已确认可执行的 Codex 二进制。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexBinary {
    pub path: PathBuf,
    pub source: CodexBinarySource,
}

/// Codex 版本探测结果。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexVersionInfo {
    pub raw: String,
    pub version: String,
}

/// 二进制定位输入；不隐式读取进程环境，由调用方显式传入。
#[derive(Clone, Debug, Default)]
pub struct LocateCodexBinaryOptions {
    pub candidate_paths: Vec<PathBuf>,
    pub environment_path: Option<PathBuf>,
    pub explicit_path: Option<PathBuf>,
}

fn invalid_input(message: String) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn require_executable(
    path: &Path,
    source: CodexBinarySource,
) -> Result<CodexBinary, CodeAgentError> {
    #[cfg(windows)]
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err(invalid_input(
            "Windows Codex binary must be a native .exe executable".to_string(),
        ));
    }
    if !is_executable(path) {
        return Err(invalid_input(format!(
            "Codex binary is not executable: {}",
            path.display()
        )));
    }
    Ok(CodexBinary {
        path: path.to_path_buf(),
        source,
    })
}

/// 按显式路径 → 环境变量路径 → 候选路径的顺序定位 Codex。
pub fn locate_codex_binary(
    options: &LocateCodexBinaryOptions,
) -> Result<CodexBinary, CodeAgentError> {
    if let Some(path) = &options.explicit_path {
        return require_executable(path, CodexBinarySource::Explicit);
    }
    if let Some(path) = &options.environment_path {
        return require_executable(path, CodexBinarySource::Environment);
    }
    for candidate in &options.candidate_paths {
        if is_executable(candidate) {
            return require_executable(candidate, CodexBinarySource::Candidate);
        }
    }
    Err(CodeAgentError::new(
        CodeAgentErrorCode::NotFound,
        "Codex binary was not found; bundle Codex or set CODE_AGENT_CODEX_BIN",
        None,
    ))
}

/// 执行 `codex --version` 并要求与受支持版本完全一致。
pub async fn check_codex_version(
    binary_path: &Path,
    env_overrides: &[(String, String)],
) -> Result<CodexVersionInfo, CodeAgentError> {
    let mut command = tokio::process::Command::new(binary_path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for (key, value) in env_overrides {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW：版本探测不允许弹出控制台窗口。
        command.creation_flags(0x0800_0000);
    }

    let output = tokio::time::timeout(VERSION_CHECK_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            CodeAgentError::new(
                CodeAgentErrorCode::Timeout,
                "Codex version check timed out",
                None,
            )
        })?
        .map_err(|error| {
            CodeAgentError::new(
                CodeAgentErrorCode::ProviderFailure,
                format!("Codex version check failed: {error}"),
                None,
            )
        })?;
    if !output.status.success() {
        return Err(CodeAgentError::new(
            CodeAgentErrorCode::ProviderFailure,
            "Codex version check failed: non-zero exit status",
            None,
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let version = raw
        .strip_prefix("codex-cli ")
        .map(str::trim)
        .unwrap_or_default();
    if version.is_empty()
        || !version
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_digit())
    {
        return Err(CodeAgentError::new(
            CodeAgentErrorCode::ProviderFailure,
            format!(
                "Invalid Codex version output: {}",
                if raw.is_empty() { "<empty>" } else { &raw }
            ),
            None,
        ));
    }
    if version != SUPPORTED_CODEX_VERSION {
        return Err(invalid_input(format!(
            "Unsupported Codex version {version}; expected {SUPPORTED_CODEX_VERSION}"
        )));
    }

    let version = version.to_string();
    Ok(CodexVersionInfo { raw, version })
}
