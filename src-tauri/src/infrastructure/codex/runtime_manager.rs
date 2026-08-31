use std::{
    collections::HashSet,
    env,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::{Client, redirect::Policy};
use serde_json::json;
use sha2::{Digest, Sha512};
use tar::Archive;
use thiserror::Error;
use tokio::{fs, io::AsyncWriteExt, task};

use super::{
    process::{SUPPORTED_CODEX_VERSION, executable_path, probe_codex_version},
    runtime_download_progress::{DownloadProgressLimiter, DownloadProgressReporter},
};
use crate::domain::runtime::{
    CodexRuntimeAvailability, CodexRuntimeAvailabilityStatus as AvailabilityStatus,
    CodexRuntimeInstallProgress,
};

const CODEX_BINARY_ENV: &str = "CODEAGENT_CODEX_BIN";
const GLOBAL_INSTALL_COMMAND: &str = "npm install -g @openai/codex@0.151.0";
const MAX_DOWNLOAD_BYTES: u64 = 192 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;
static INSTALL_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
pub enum RuntimeDiscoveryError {
    #[error("compatible Codex binary was not found")]
    NotFound,
    #[error("installed Codex version is not supported")]
    Incompatible,
    #[error("failed to inspect installed Codex binaries")]
    ProbeFailed,
}

#[derive(Debug, Error)]
pub enum RuntimeInstallError {
    #[error("the current platform does not have a supported Codex package")]
    UnsupportedPlatform,
    #[error("failed to download the Codex package")]
    Download(#[from] reqwest::Error),
    #[error("the Codex package exceeds the download limit")]
    DownloadTooLarge,
    #[error("the Codex package integrity check failed")]
    Integrity,
    #[error("the Codex package archive is invalid")]
    Archive,
    #[error("failed to update the private Codex installation")]
    Filesystem(#[from] io::Error),
    #[error("the downloaded Codex binary failed validation")]
    Validation,
    #[error("the Codex extraction task failed")]
    ExtractionTask,
}

pub(super) struct Distribution {
    pub(super) target: &'static str,
    pub(super) url: &'static str,
    pub(super) integrity: &'static str,
}

struct Inspection {
    availability: CodexRuntimeAvailability,
    binary_path: Option<PathBuf>,
}

pub async fn inspect_codex_runtime(app_data: &Path) -> CodexRuntimeAvailability {
    inspect(app_data).await.availability
}

pub async fn find_compatible_codex_binary(
    app_data: &Path,
) -> Result<PathBuf, RuntimeDiscoveryError> {
    let inspection = inspect(app_data).await;
    if let Some(binary_path) = inspection.binary_path {
        return Ok(binary_path);
    }
    match inspection.availability.status {
        AvailabilityStatus::Incompatible => Err(RuntimeDiscoveryError::Incompatible),
        AvailabilityStatus::Failed => Err(RuntimeDiscoveryError::ProbeFailed),
        AvailabilityStatus::Compatible | AvailabilityStatus::Missing => {
            Err(RuntimeDiscoveryError::NotFound)
        }
    }
}

pub async fn install_codex_runtime<OnProgress>(
    app_data: &Path,
    on_progress: OnProgress,
) -> Result<CodexRuntimeAvailability, RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    // 等待同一 Provider 的前序安装后再次检查，兼容版本已就绪时直接复用，避免重复传输大包。
    let current = inspect(app_data).await;
    if current.availability.status == AvailabilityStatus::Compatible {
        return Ok(current.availability);
    }
    let distribution = distribution_for(env::consts::OS, env::consts::ARCH)
        .ok_or(RuntimeInstallError::UnsupportedPlatform)?;
    let bin_root = app_data.join("providers/codex/bin");
    fs::create_dir_all(&bin_root).await?;

    let install_id = INSTALL_ID.fetch_add(1, Ordering::Relaxed);
    let archive_path = bin_root.join(format!(".codex-{install_id}.tgz"));
    let staging_dir = bin_root.join(format!(".{SUPPORTED_CODEX_VERSION}-{install_id}.install"));
    let final_dir = bin_root.join(SUPPORTED_CODEX_VERSION);

    let result = install_distribution(
        app_data,
        distribution,
        &archive_path,
        &staging_dir,
        &final_dir,
        &on_progress,
    )
    .await;
    let _ = fs::remove_file(&archive_path).await;
    let _ = fs::remove_dir_all(&staging_dir).await;
    result?;

    Ok(inspect_codex_runtime(app_data).await)
}

async fn inspect(app_data: &Path) -> Inspection {
    let (candidates, mut had_probe_failure) = candidate_paths(app_data);
    let had_candidate = !candidates.is_empty();
    let mut detected_version = None;

    for candidate in candidates {
        match probe_codex_version(&candidate).await {
            Ok(version) if version == SUPPORTED_CODEX_VERSION => {
                return Inspection {
                    availability: availability(AvailabilityStatus::Compatible, Some(version)),
                    binary_path: Some(candidate),
                };
            }
            Ok(version) => {
                detected_version.get_or_insert(version);
            }
            Err(_) => had_probe_failure = true,
        };
    }

    let status = if detected_version.is_some() {
        AvailabilityStatus::Incompatible
    } else if had_probe_failure || had_candidate {
        AvailabilityStatus::Failed
    } else {
        AvailabilityStatus::Missing
    };
    Inspection {
        availability: availability(status, detected_version),
        binary_path: None,
    }
}

fn availability(
    status: AvailabilityStatus,
    detected_version: Option<String>,
) -> CodexRuntimeAvailability {
    CodexRuntimeAvailability {
        detected_version,
        global_install_command: GLOBAL_INSTALL_COMMAND,
        required_version: SUPPORTED_CODEX_VERSION,
        status,
    }
}

fn candidate_paths(app_data: &Path) -> (Vec<PathBuf>, bool) {
    let executable_names = codex_executable_names(env::consts::OS);
    let mut raw_paths = Vec::new();
    let mut invalid_explicit_path = false;

    if let Some(explicit) = env::var_os(CODEX_BINARY_ENV) {
        let path = PathBuf::from(explicit);
        if path.is_absolute() {
            raw_paths.push(path);
        } else {
            invalid_explicit_path = true;
        }
    }
    raw_paths.push(private_codex_binary_path(app_data));
    if let Some(path) = env::var_os("PATH") {
        raw_paths.extend(env::split_paths(&path).flat_map(|directory| {
            executable_names
                .iter()
                .map(move |executable| directory.join(executable))
        }));
    }
    raw_paths.extend(common_binary_paths(executable_names));

    let mut seen = HashSet::new();
    let candidates = raw_paths
        .into_iter()
        .filter_map(|path| executable_path(&path))
        .filter(|path| seen.insert(path.clone()))
        .collect();
    (candidates, invalid_explicit_path)
}

pub(super) fn codex_executable_names(os: &str) -> &'static [&'static str] {
    if os == "windows" {
        // npm 在 Windows 全局安装时生成 codex.cmd shim，必须与独立版 codex.exe 一并检测。
        &["codex.exe", "codex.cmd"]
    } else {
        &["codex"]
    }
}

fn common_binary_paths(executable_names: &[&str]) -> Vec<PathBuf> {
    let mut directories = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ];
    if let Some(home) = env::var_os("HOME") {
        directories.push(PathBuf::from(home).join(".local/bin"));
    }
    if let Some(app_data) = env::var_os("APPDATA") {
        // 默认 npm global prefix 位于 %APPDATA%\npm，应用安装期间 PATH 不更新也能立即闭环。
        directories.push(PathBuf::from(app_data).join("npm"));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        directories.push(PathBuf::from(local_app_data).join("Programs/Codex"));
    }
    directories
        .into_iter()
        .flat_map(|directory| {
            executable_names
                .iter()
                .map(move |executable| directory.join(executable))
        })
        .collect()
}

pub(super) fn private_codex_binary_path(app_data: &Path) -> PathBuf {
    app_data
        .join("providers/codex/bin")
        .join(SUPPORTED_CODEX_VERSION)
        .join("bin")
        .join(format!("codex{}", env::consts::EXE_SUFFIX))
}

pub(super) fn distribution_for(os: &str, arch: &str) -> Option<&'static Distribution> {
    match (os, arch) {
        ("macos", "aarch64") => Some(&DARWIN_ARM64),
        ("linux", "aarch64") => Some(&LINUX_ARM64),
        ("linux", "x86_64") => Some(&LINUX_X64),
        ("windows", "aarch64") => Some(&WINDOWS_ARM64),
        ("windows", "x86_64") => Some(&WINDOWS_X64),
        _ => None,
    }
}

async fn install_distribution<OnProgress>(
    app_data: &Path,
    distribution: &Distribution,
    archive_path: &Path,
    staging_dir: &Path,
    final_dir: &Path,
    on_progress: &OnProgress,
) -> Result<(), RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    download_verified(distribution, archive_path, on_progress).await?;
    let archive = archive_path.to_owned();
    let staging = staging_dir.to_owned();
    let target = distribution.target;
    task::spawn_blocking(move || extract_distribution(&archive, &staging, target))
        .await
        .map_err(|_| RuntimeInstallError::ExtractionTask)??;

    let staged_binary = staging_dir
        .join("bin")
        .join(format!("codex{}", env::consts::EXE_SUFFIX));
    if probe_codex_version(&staged_binary).await.ok().as_deref() != Some(SUPPORTED_CODEX_VERSION) {
        return Err(RuntimeInstallError::Validation);
    }

    replace_runtime_directory(final_dir, staging_dir).await?;
    write_active_runtime(app_data, &private_codex_binary_path(app_data)).await?;
    Ok(())
}

async fn download_verified<OnProgress>(
    distribution: &Distribution,
    archive_path: &Path,
    on_progress: &OnProgress,
) -> Result<(), RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    // URL 与 SHA-512 均由应用固定，WebView 无法注入下载源或替换校验值。
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .redirect(Policy::none())
        .build()?;
    let response = client
        .get(distribution.url)
        .send()
        .await?
        .error_for_status()?;
    let content_length = response.content_length();
    if content_length.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err(RuntimeInstallError::DownloadTooLarge);
    }
    let total_bytes = content_length.filter(|length| *length > 0);
    let mut progress_reporter = DownloadProgressReporter::new(on_progress, total_bytes);
    progress_reporter.report(0);

    let mut file = fs::File::create(archive_path).await?;
    let mut stream = response.bytes_stream();
    let mut digest = Sha512::new();
    let mut downloaded = 0_u64;
    let mut progress_limiter = DownloadProgressLimiter::new(total_bytes);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_DOWNLOAD_BYTES {
            return Err(RuntimeInstallError::DownloadTooLarge);
        }
        digest.update(&chunk);
        file.write_all(&chunk).await?;
        // 百分比不变时不跨 IPC 上报，避免网络小分块造成 WebView 高频重复渲染。
        if progress_limiter.advance(downloaded) {
            progress_reporter.report(downloaded);
        }
    }
    if progress_limiter.finish(downloaded) {
        progress_reporter.report(downloaded);
    }
    file.flush().await?;

    let expected = STANDARD
        .decode(distribution.integrity)
        .map_err(|_| RuntimeInstallError::Integrity)?;
    if digest.finalize().as_slice() != expected {
        return Err(RuntimeInstallError::Integrity);
    }
    Ok(())
}

fn extract_distribution(
    archive_path: &Path,
    staging_dir: &Path,
    target: &str,
) -> Result<(), RuntimeInstallError> {
    std::fs::create_dir_all(staging_dir)?;
    let file = std::fs::File::open(archive_path)?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let prefix = PathBuf::from("package/vendor").join(target);
    let mut unpacked = 0_u64;

    for entry in archive
        .entries()
        .map_err(|_| RuntimeInstallError::Archive)?
    {
        let mut entry = entry.map_err(|_| RuntimeInstallError::Archive)?;
        let path = entry
            .path()
            .map_err(|_| RuntimeInstallError::Archive)?
            .into_owned();
        // 仅提取当前 target 的 vendor 子树，并拒绝所有非普通路径组件，阻止归档越界写入。
        let Ok(relative) = path.strip_prefix(&prefix) else {
            continue;
        };
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(RuntimeInstallError::Archive);
        }
        let destination = staging_dir.join(relative);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&destination)?;
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(RuntimeInstallError::Archive);
        }
        let entry_size = entry.size();
        unpacked = unpacked.saturating_add(entry_size);
        if unpacked > MAX_UNPACKED_BYTES {
            return Err(RuntimeInstallError::Archive);
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output = std::fs::File::create(&destination)?;
        io::copy(&mut entry, &mut output)?;
        output.flush()?;
        set_archive_permissions(&destination, entry.header().mode().unwrap_or(0o644))?;
    }

    if !staging_dir.join("bin").join(executable_name()).is_file() {
        return Err(RuntimeInstallError::Archive);
    }
    Ok(())
}

#[cfg(unix)]
fn set_archive_permissions(path: &Path, mode: u32) -> Result<(), io::Error> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode & 0o777))
}

#[cfg(not(unix))]
fn set_archive_permissions(_path: &Path, _mode: u32) -> Result<(), io::Error> {
    Ok(())
}

fn executable_name() -> String {
    format!("codex{}", env::consts::EXE_SUFFIX)
}

async fn replace_runtime_directory(final_dir: &Path, staging_dir: &Path) -> Result<(), io::Error> {
    // 先保留旧目录；新目录原子切换失败时立即恢复，避免破坏已有可用版本。
    let backup = final_dir.with_extension(format!(
        "backup-{}",
        INSTALL_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let had_previous = fs::try_exists(final_dir).await?;
    if had_previous {
        fs::rename(final_dir, &backup).await?;
    }
    if let Err(error) = fs::rename(staging_dir, final_dir).await {
        if had_previous {
            let _ = fs::rename(&backup, final_dir).await;
        }
        return Err(error);
    }
    if had_previous {
        let _ = fs::remove_dir_all(backup).await;
    }
    Ok(())
}

async fn write_active_runtime(app_data: &Path, binary_path: &Path) -> Result<(), io::Error> {
    let provider_root = app_data.join("providers/codex");
    let active_path = provider_root.join("active.json");
    let temporary = provider_root.join(format!(
        ".active-{}.tmp",
        INSTALL_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let payload = serde_json::to_vec(&json!({
        "path": binary_path.to_string_lossy(),
        "version": SUPPORTED_CODEX_VERSION,
    }))?;
    fs::write(&temporary, payload).await?;
    if let Err(error) = fs::rename(&temporary, &active_path).await {
        if !matches!(
            error.kind(),
            io::ErrorKind::AlreadyExists | io::ErrorKind::PermissionDenied
        ) {
            return Err(error);
        }
        let _ = fs::remove_file(&active_path).await;
        fs::rename(&temporary, &active_path).await?;
    }
    Ok(())
}

const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-darwin-arm64.tgz",
    integrity: "g7YzpaCZGCw19R/gly3vRPjnLqaW7JcBAu2WQQ6e8PIlvBPmS/gMplIUURMgNO6gi8LsPzdlQtLqkwoeOOlIdg==",
};
const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-linux-arm64.tgz",
    integrity: "CsLgFeX4TQ6I2Gdrxd2r5UbgIbDLCdtcLAlnMYjr06bCL057MTNGec7Ewb3+Z2DBiMuXCljdTBGqLOePkMV0sQ==",
};
const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-linux-x64.tgz",
    integrity: "xcVyY1FtwvVYhh2JBmz8fX8CQqFAxO/lxJ2IXsh8x5uwxZVHVl5fZHFHf8JdRaOGG0vpkYmu/DKKVoLd56/DDQ==",
};
const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-win32-arm64.tgz",
    integrity: "zDWzOoh9wHm+Om1Nhn7os47rAVeSGPh0SnM3YOttdq6iPJz2zn4vBnbGUZjeih1qW/3mvNF3Oyd4owlaHmphmg==",
};
const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-win32-x64.tgz",
    integrity: "sLT7xvID3jhU6tkzcwRPnMEclKRwUPbpo0mtfxIF9KpdZH3VJV7sM2/kXWXyvUM7Zt/YeyOaeATTEysbRz8Yog==",
};
