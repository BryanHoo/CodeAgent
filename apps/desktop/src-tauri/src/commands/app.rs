use std::sync::Arc;

use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

use crate::{command_error::CommandError, platform_adapters::DesktopProvider};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoResponse {
    app_version: String,
    codex_version: String,
    error: Option<String>,
    latest_version: Option<String>,
    release_notes: Option<String>,
    status: &'static str,
    update_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallAppUpdateResponse {
    app_version: String,
    codex_version: String,
    error: Option<String>,
    latest_version: String,
    release_notes: Option<String>,
    status: &'static str,
    update_available: bool,
}

struct CheckedUpdate {
    release_notes: Option<String>,
    version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessStatusResponse {
    authenticated: bool,
    mode: &'static str,
    version: u8,
}

#[derive(Debug, Serialize)]
pub struct DiagnosticsResponse {
    runtime: crate::platform_adapters::RuntimeReadiness,
    status: &'static str,
    version: u8,
}

#[tauri::command]
pub async fn app_info(app: AppHandle, request_id: String) -> Result<AppInfoResponse, CommandError> {
    validate_request_id(&request_id)?;
    #[cfg(feature = "desktop-e2e")]
    if request_id == "desktop-ipc-e2e" {
        // IPC E2E 只隔离 updater 网络请求，命令注册、参数校验与响应序列化仍走真实链路。
        return Ok(app_info_response(Ok(None)));
    }
    if cfg!(debug_assertions) {
        // 本地开发构建没有可用的签名 release manifest，跳过 updater 避免误报检查失败。
        return Ok(app_info_response(Ok(None)));
    }
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => return Ok(app_info_response(Err(error.to_string()))),
    };
    let checked = match updater.check().await {
        Ok(Some(update)) => Ok(Some(CheckedUpdate {
            release_notes: update.body,
            version: update.version,
        })),
        Ok(None) => Ok(None),
        Err(error) => Err(error.to_string()),
    };
    Ok(app_info_response(checked))
}

#[tauri::command]
pub async fn app_update_install(
    app: AppHandle,
    idempotency_key: String,
    request_id: String,
    version: String,
) -> Result<InstallAppUpdateResponse, CommandError> {
    validate_request_id(&request_id)?;
    validate_request_id(&idempotency_key)?;
    let updater = app
        .updater()
        .map_err(|error| CommandError::update_check_failed(error.to_string()))?;
    let update = updater
        .check()
        .await
        .map_err(|error| CommandError::update_check_failed(error.to_string()))?;
    validate_install_target(
        &version,
        update.as_ref().map(|available| available.version.as_str()),
    )?;
    let Some(update) = update else {
        return Err(CommandError::update_not_available());
    };

    // Updater 在写入安装包前使用配置中的公钥验证下载签名。
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| CommandError::update_install_failed(error.to_string()))?;
    let response = install_response(&version);
    tauri::async_runtime::spawn(async move {
        // 先让 IPC 响应送达 Renderer，再进入 Tauri 的完整重启生命周期。
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        app.restart();
    });
    Ok(response)
}

fn app_info_response(check: Result<Option<CheckedUpdate>, String>) -> AppInfoResponse {
    let current = AppInfoResponse {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        codex_version: codex_version(),
        error: None,
        latest_version: None,
        release_notes: None,
        status: "current",
        update_available: false,
    };
    match check {
        Ok(Some(update)) => AppInfoResponse {
            latest_version: Some(update.version),
            release_notes: update.release_notes.map(truncate_release_notes),
            status: "available",
            update_available: true,
            ..current
        },
        Ok(None) => current,
        Err(error) => AppInfoResponse {
            error: Some(error),
            status: "check-failed",
            ..current
        },
    }
}

fn install_response(version: &str) -> InstallAppUpdateResponse {
    InstallAppUpdateResponse {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        codex_version: codex_version(),
        error: None,
        latest_version: version.to_owned(),
        release_notes: None,
        status: "restart-required",
        update_available: false,
    }
}

fn validate_install_target(
    requested_version: &str,
    available_version: Option<&str>,
) -> Result<(), CommandError> {
    if available_version != Some(requested_version) {
        return Err(CommandError::update_not_available());
    }
    Ok(())
}

fn truncate_release_notes(notes: String) -> String {
    notes.chars().take(32_768).collect()
}

fn codex_version() -> String {
    code_agent_provider_codex::SUPPORTED_CODEX_VERSION.to_owned()
}

#[tauri::command]
pub async fn access_status(request_id: String) -> Result<AccessStatusResponse, CommandError> {
    validate_request_id(&request_id)?;
    Ok(AccessStatusResponse {
        authenticated: true,
        mode: "local",
        version: 1,
    })
}

#[tauri::command]
pub async fn app_diagnostics(
    request_id: String,
    provider: State<'_, Arc<DesktopProvider>>,
) -> Result<DiagnosticsResponse, CommandError> {
    validate_request_id(&request_id)?;
    Ok(DiagnosticsResponse {
        runtime: provider.readiness(),
        status: "ok",
        version: 1,
    })
}

#[tauri::command]
pub async fn cancel_operation(
    request_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<bool, CommandError> {
    validate_request_id(&request_id)?;
    Ok(runtime.cancel_operation(&request_id).await)
}

fn validate_request_id(request_id: &str) -> Result<(), CommandError> {
    if request_id.trim().is_empty() {
        return Err(CommandError::invalid_request("requestId must not be empty"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        CheckedUpdate, access_status, app_info_response, install_response, validate_install_target,
    };

    #[test]
    fn returns_phase_two_host_contracts() {
        tauri::async_runtime::block_on(async {
            assert!(access_status("access-1".to_owned()).await.is_ok());
        });
    }

    #[test]
    fn maps_updater_checks_to_the_shared_app_info_contract() {
        let available = app_info_response(Ok(Some(CheckedUpdate {
            release_notes: Some("修复更新流程".repeat(20_000)),
            version: "1.11.0".to_owned(),
        })));
        assert_eq!(available.status, "available");
        assert!(available.update_available);
        assert_eq!(available.latest_version, Some("1.11.0".to_owned()));
        assert_eq!(
            available
                .release_notes
                .as_deref()
                .expect("release notes must be retained")
                .chars()
                .count(),
            32_768
        );

        let current = app_info_response(Ok(None));
        assert_eq!(current.status, "current");
        assert!(!current.update_available);

        let failed = app_info_response(Err("GitHub returned 503".to_owned()));
        assert_eq!(failed.status, "check-failed");
        assert_eq!(failed.error.as_deref(), Some("GitHub returned 503"));
    }

    #[test]
    fn installs_only_the_requested_checked_version() {
        assert!(validate_install_target("1.11.0", Some("1.11.0")).is_ok());

        let error = validate_install_target("1.11.0", Some("1.12.0"))
            .expect_err("a stale requested version must be rejected");
        assert_eq!(error.code, "update_not_available");

        let response = install_response("1.11.0");
        assert_eq!(response.latest_version, "1.11.0");
        assert_eq!(response.status, "restart-required");
        assert!(!response.update_available);
    }

    #[test]
    fn rejects_empty_request_ids() {
        tauri::async_runtime::block_on(async {
            let error = access_status("  ".to_owned())
                .await
                .expect_err("empty requestId must be rejected");
            assert_eq!(error.code, "invalid_request");
        });
    }
}
