use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use code_agent_core::{CodeAgentError, ProviderPort};
use code_agent_provider_codex::{
    CodexAppServerOptions, CodexAppServerProcess, CodexRuntimeProvider, LocateCodexBinaryOptions,
    locate_codex_binary, start_codex_app_server,
};
use tokio::sync::Mutex;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::desktop_provider::DesktopProvider;
use crate::process_environment::prepend_process_path;

const INITIAL_RESTART_DELAY: Duration = Duration::from_millis(250);
const MAX_RESTART_DELAY: Duration = Duration::from_secs(10);
const STABLE_PROCESS_UPTIME: Duration = Duration::from_secs(30);

struct RestartBackoff {
    consecutive_failures: u32,
}

impl RestartBackoff {
    fn new() -> Self {
        Self {
            consecutive_failures: 0,
        }
    }

    fn next_delay(&mut self, uptime: Duration) -> Duration {
        if uptime >= STABLE_PROCESS_UPTIME {
            self.consecutive_failures = 0;
        }
        let exponent = self.consecutive_failures.min(6);
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        INITIAL_RESTART_DELAY
            .saturating_mul(1_u32 << exponent)
            .min(MAX_RESTART_DELAY)
    }
}

pub struct CodexSupervisor {
    process: Mutex<Option<Arc<CodexAppServerProcess>>>,
    shutdown: CancellationToken,
}

impl Default for CodexSupervisor {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            shutdown: CancellationToken::new(),
        }
    }
}

impl CodexSupervisor {
    async fn set(&self, process: Arc<CodexAppServerProcess>) -> bool {
        let mut slot = self.process.lock().await;
        if self.shutdown.is_cancelled() {
            return false;
        }
        *slot = Some(process);
        true
    }

    async fn clear(&self, process: &Arc<CodexAppServerProcess>) {
        let mut slot = self.process.lock().await;
        if slot
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, process))
        {
            *slot = None;
        }
    }

    pub async fn close(&self) -> Result<(), CodeAgentError> {
        self.shutdown.cancel();
        let process = self.process.lock().await.take();
        if let Some(process) = process {
            process.close().await
        } else {
            Ok(())
        }
    }
}

/// 持续监管 Codex App Server，并在异常退出或握手失败后执行有上限退避恢复。
pub async fn start_codex_supervisor(
    provider_slot: Arc<DesktopProvider>,
    supervisor: Arc<CodexSupervisor>,
    app_version: String,
    resource_directory: PathBuf,
    codex_home: PathBuf,
    host_process_path: OsString,
) {
    let binary = match locate_desktop_codex(&resource_directory) {
        Ok(binary) => binary,
        Err(error) => {
            provider_slot.fail(error.message());
            return;
        }
    };
    let environment = desktop_codex_environment(&binary, &codex_home, &host_process_path);
    let mut backoff = RestartBackoff::new();

    loop {
        if supervisor.shutdown.is_cancelled() {
            return;
        }
        let started_at = Instant::now();
        let process = match start_codex_app_server(CodexAppServerOptions {
            app_version: app_version.clone(),
            binary_path: binary.clone(),
            env_overrides: environment.clone(),
            ..CodexAppServerOptions::default()
        })
        .await
        {
            Ok(process) => Arc::new(process),
            Err(error) => {
                provider_slot.fail(error.message());
                if wait_for_restart(&supervisor, backoff.next_delay(started_at.elapsed())).await {
                    return;
                }
                continue;
            }
        };
        if !supervisor.set(process.clone()).await {
            let _ = process.close().await;
            return;
        }
        let Some(incoming) = process.take_incoming() else {
            provider_slot.fail("Codex incoming RPC stream is unavailable");
            supervisor.clear(&process).await;
            let _ = process.close().await;
            if wait_for_restart(&supervisor, backoff.next_delay(started_at.elapsed())).await {
                return;
            }
            continue;
        };
        let provider: Arc<dyn ProviderPort> = Arc::new(CodexRuntimeProvider::new_with_codex_home(
            process.client().clone(),
            incoming,
            codex_home.clone(),
        ));
        if let Err(error) = provider_slot.install(provider).await {
            provider_slot.fail(error.message());
            supervisor.clear(&process).await;
            let _ = process.close().await;
            if wait_for_restart(&supervisor, backoff.next_delay(started_at.elapsed())).await {
                return;
            }
            continue;
        }

        let exit = tokio::select! {
            _ = supervisor.shutdown.cancelled() => {
                let _ = process.close().await;
                supervisor.clear(&process).await;
                return;
            }
            exit = process.wait_for_exit() => exit,
        };
        supervisor.clear(&process).await;
        let detail = process.stderr_tail();
        provider_slot.fail(format!(
            "Codex App Server exited with code {:?}, signal {:?}{}",
            exit.code,
            exit.signal,
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
        if wait_for_restart(&supervisor, backoff.next_delay(started_at.elapsed())).await {
            return;
        }
    }
}

async fn wait_for_restart(supervisor: &CodexSupervisor, delay: Duration) -> bool {
    tokio::select! {
        _ = supervisor.shutdown.cancelled() => true,
        _ = tokio::time::sleep(delay) => false,
    }
}

fn desktop_codex_environment(
    binary: &Path,
    codex_home: &Path,
    host_process_path: &OsStr,
) -> Vec<(String, String)> {
    let binary_directory = binary.parent().unwrap_or_else(|| Path::new("."));
    let package_directory = binary_directory
        .parent()
        .filter(|directory| directory.join("codex-package.json").is_file())
        .unwrap_or(binary_directory);
    let managed_directories = [
        package_directory.join("codex-path"),
        binary_directory.to_path_buf(),
    ]
    .into_iter()
    .filter(|path| path.is_dir())
    .collect::<Vec<_>>();
    let path = prepend_process_path(&managed_directories, host_process_path)
        .to_string_lossy()
        .into_owned();

    // 受管目录保持最高优先级，同时让 GUI 启动的 Codex 能找到用户配置的 MCP 启动器。
    vec![
        (
            "CODEX_HOME".to_string(),
            codex_home.to_string_lossy().into_owned(),
        ),
        ("PATH".to_string(), path),
    ]
}

fn locate_desktop_codex(resource_directory: &Path) -> Result<PathBuf, CodeAgentError> {
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let candidates = vec![
        resource_directory
            .join("codex-runtime")
            .join("bin")
            .join(format!("codex{suffix}")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("codex-runtime")
            .join("bin")
            .join(format!("codex{suffix}")),
    ];
    let environment_path = std::env::var_os("CODE_AGENT_CODEX_BIN").map(PathBuf::from);
    locate_codex_binary(&LocateCodexBinaryOptions {
        candidate_paths: candidates,
        environment_path,
        explicit_path: None,
    })
    .map(|binary| binary.path)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{INITIAL_RESTART_DELAY, MAX_RESTART_DELAY, RestartBackoff};

    #[test]
    fn restart_backoff_is_capped_and_resets_after_stable_uptime() {
        let mut backoff = RestartBackoff::new();
        assert_eq!(backoff.next_delay(Duration::ZERO), INITIAL_RESTART_DELAY);
        assert_eq!(
            backoff.next_delay(Duration::ZERO),
            INITIAL_RESTART_DELAY * 2
        );
        for _ in 0..10 {
            backoff.next_delay(Duration::ZERO);
        }
        assert_eq!(backoff.next_delay(Duration::ZERO), MAX_RESTART_DELAY);
        assert_eq!(
            backoff.next_delay(super::STABLE_PROCESS_UPTIME),
            INITIAL_RESTART_DELAY
        );
    }
}
