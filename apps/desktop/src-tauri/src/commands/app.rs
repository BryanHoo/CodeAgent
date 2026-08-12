use std::sync::Arc;

use code_agent_runtime::CodeAgentRuntime;
use serde::Serialize;
use tauri::State;

use crate::command_error::CommandError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoResponse {
    app_version: &'static str,
    codex_version: &'static str,
    latest_version: Option<&'static str>,
    release_notes: Option<&'static str>,
    status: &'static str,
    update_available: bool,
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
    status: &'static str,
    version: u8,
}

#[tauri::command]
pub async fn app_info(request_id: String) -> Result<AppInfoResponse, CommandError> {
    validate_request_id(&request_id)?;
    Ok(AppInfoResponse {
        app_version: env!("CARGO_PKG_VERSION"),
        codex_version: "0.147.0",
        latest_version: None,
        release_notes: None,
        status: "current",
        update_available: false,
    })
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
pub async fn app_diagnostics(request_id: String) -> Result<DiagnosticsResponse, CommandError> {
    validate_request_id(&request_id)?;
    Ok(DiagnosticsResponse {
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
        return Err(CommandError {
            code: "invalid_request".to_owned(),
            message: "requestId must not be empty".to_owned(),
            retryable: false,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{access_status, app_diagnostics, app_info};

    #[test]
    fn returns_phase_two_host_contracts() {
        tauri::async_runtime::block_on(async {
            assert!(app_info("info-1".to_owned()).await.is_ok());
            assert!(access_status("access-1".to_owned()).await.is_ok());
            assert!(app_diagnostics("diagnostics-1".to_owned()).await.is_ok());
        });
    }

    #[test]
    fn rejects_empty_request_ids() {
        tauri::async_runtime::block_on(async {
            let error = app_diagnostics("  ".to_owned())
                .await
                .expect_err("empty requestId must be rejected");
            assert_eq!(error.code, "invalid_request");
        });
    }
}
