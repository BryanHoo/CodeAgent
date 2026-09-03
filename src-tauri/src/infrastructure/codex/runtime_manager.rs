use std::{
    collections::HashSet,
    env,
    ffi::OsString,
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
    process::{SUPPORTED_CODEX_VERSION, is_compatible_codex_version, probe_codex_version},
    runtime_active::read_active_codex_runtime,
    runtime_discovery::{
        expanded_candidate_paths, initial_candidate_paths, private_codex_binary_path,
    },
    runtime_distributions::{DARWIN_ARM64, LINUX_ARM64, LINUX_X64, WINDOWS_ARM64, WINDOWS_X64},
    runtime_download_progress::{DownloadProgressLimiter, DownloadProgressReporter},
    runtime_path::resolve_runtime_path,
};
use crate::domain::runtime::{
    CodexRuntimeAvailability, CodexRuntimeAvailabilityStatus as AvailabilityStatus,
    CodexRuntimeInstallPhase, CodexRuntimeInstallProgress,
};

const GLOBAL_INSTALL_COMMAND: &str = "npm install -g @openai/codex@0.152.1";
const MAX_CONCURRENT_PROBES: usize = 4;
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

#[derive(Default)]
struct ProbeSummary {
    compatible: Option<(PathBuf, String)>,
    detected_version: Option<String>,
    had_probe_failure: bool,
    had_candidate: bool,
}

pub async fn inspect_codex_runtime(app_data: &Path) -> CodexRuntimeAvailability {
    inspect(app_data).await.availability
}

pub async fn find_compatible_codex_binary(
    app_data: &Path,
) -> Result<(PathBuf, String, Option<OsString>), RuntimeDiscoveryError> {
    let runtime_path = resolve_runtime_path().await;
    let inspection = inspect_with_runtime_path(app_data, runtime_path.as_deref()).await;
    if let Some(binary_path) = inspection.binary_path {
        let version = inspection
            .availability
            .detected_version
            .ok_or(RuntimeDiscoveryError::ProbeFailed)?;
        return Ok((binary_path, version, runtime_path));
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
    let current_version = read_active_codex_runtime(app_data).map(|active| active.version);
    let mut progress = DownloadProgressReporter::new(&on_progress, current_version);
    progress.report_phase(CodexRuntimeInstallPhase::Preparing);
    let result = install_codex_runtime_inner(app_data, &mut progress).await;
    if result.is_err() {
        progress.report_phase(CodexRuntimeInstallPhase::Failed);
    }
    result
}

async fn install_codex_runtime_inner<OnProgress>(
    app_data: &Path,
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
) -> Result<CodexRuntimeAvailability, RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    // 仅复用应用固定的私有版本；系统中的兼容版本不能替代用户已选择的私有安装。
    let private_binary = private_codex_binary_path(app_data);
    if probe_codex_version(&private_binary, None)
        .await
        .ok()
        .as_deref()
        == Some(SUPPORTED_CODEX_VERSION)
    {
        write_active_runtime(app_data, &private_binary).await?;
        progress.report_phase(CodexRuntimeInstallPhase::Ready);
        return Ok(inspect_codex_runtime(app_data).await);
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
        progress,
    )
    .await;
    let _ = fs::remove_file(&archive_path).await;
    let _ = fs::remove_dir_all(&staging_dir).await;
    result?;

    Ok(inspect_codex_runtime(app_data).await)
}

async fn inspect(app_data: &Path) -> Inspection {
    let runtime_path = resolve_runtime_path().await;
    inspect_with_runtime_path(app_data, runtime_path.as_deref()).await
}

async fn inspect_with_runtime_path(
    app_data: &Path,
    runtime_path: Option<&std::ffi::OsStr>,
) -> Inspection {
    let initial = initial_candidate_paths(app_data, runtime_path);
    let mut seen = initial.paths.iter().cloned().collect::<HashSet<_>>();
    let mut summary = probe_candidates(initial.paths, runtime_path).await;
    summary.had_probe_failure |= initial.had_invalid_explicit_path;
    if let Some(inspection) = compatible_inspection(summary.compatible.take()) {
        return inspection;
    }

    // 首轮未命中后才查询包管理器与版本管理器，避免正常启动产生额外进程和目录遍历。
    let mut expanded = expanded_candidate_paths(runtime_path).await;
    expanded.retain(|candidate| seen.insert(candidate.clone()));
    let expanded_summary = probe_candidates(expanded, runtime_path).await;
    if let Some(inspection) = compatible_inspection(expanded_summary.compatible) {
        return inspection;
    }
    summary.detected_version = summary
        .detected_version
        .or(expanded_summary.detected_version);
    summary.had_probe_failure |= expanded_summary.had_probe_failure;
    summary.had_candidate |= expanded_summary.had_candidate;

    let status = if summary.detected_version.is_some() {
        AvailabilityStatus::Incompatible
    } else if summary.had_probe_failure || summary.had_candidate {
        AvailabilityStatus::Failed
    } else {
        AvailabilityStatus::Missing
    };
    Inspection {
        availability: availability(status, summary.detected_version),
        binary_path: None,
    }
}

async fn probe_candidates(
    candidates: Vec<PathBuf>,
    runtime_path: Option<&std::ffi::OsStr>,
) -> ProbeSummary {
    let had_candidate = !candidates.is_empty();
    let mut probes = futures_util::stream::iter(candidates)
        .map(|candidate| async move {
            let result = probe_codex_version(&candidate, runtime_path).await;
            (candidate, result)
        })
        .buffered(MAX_CONCURRENT_PROBES);
    let mut summary = ProbeSummary {
        had_candidate,
        ..ProbeSummary::default()
    };
    while let Some((candidate, result)) = probes.next().await {
        match result {
            Ok(version) if is_compatible_codex_version(&version) => {
                summary.compatible = Some((candidate, version));
                return summary;
            }
            Ok(version) => {
                summary.detected_version.get_or_insert(version);
            }
            Err(_) => summary.had_probe_failure = true,
        }
    }
    summary
}

fn compatible_inspection(compatible: Option<(PathBuf, String)>) -> Option<Inspection> {
    compatible.map(|(binary_path, version)| Inspection {
        availability: availability(AvailabilityStatus::Compatible, Some(version)),
        binary_path: Some(binary_path),
    })
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
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
) -> Result<(), RuntimeInstallError>
where
    OnProgress: Fn(CodexRuntimeInstallProgress) + Send + Sync,
{
    download_verified(distribution, archive_path, progress).await?;
    progress.report_phase(CodexRuntimeInstallPhase::Installing);
    let archive = archive_path.to_owned();
    let staging = staging_dir.to_owned();
    let target = distribution.target;
    task::spawn_blocking(move || extract_distribution(&archive, &staging, target))
        .await
        .map_err(|_| RuntimeInstallError::ExtractionTask)??;

    let staged_binary = staging_dir
        .join("bin")
        .join(format!("codex{}", env::consts::EXE_SUFFIX));
    if probe_codex_version(&staged_binary, None)
        .await
        .ok()
        .as_deref()
        != Some(SUPPORTED_CODEX_VERSION)
    {
        return Err(RuntimeInstallError::Validation);
    }

    replace_runtime_directory(final_dir, staging_dir).await?;
    write_active_runtime(app_data, &private_codex_binary_path(app_data)).await?;
    progress.report_phase(CodexRuntimeInstallPhase::Ready);
    Ok(())
}

async fn download_verified<OnProgress>(
    distribution: &Distribution,
    archive_path: &Path,
    progress: &mut DownloadProgressReporter<'_, OnProgress>,
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
    progress.start_download(total_bytes);

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
            progress.report_download(downloaded);
        }
    }
    if progress_limiter.finish(downloaded) {
        progress.report_download(downloaded);
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
