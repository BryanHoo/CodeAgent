use serde::Serialize;
use tauri::{AppHandle, Runtime, plugin::PermissionState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

use crate::command_error::CommandError;

#[cfg(target_os = "macos")]
const HOST_NOTIFICATION_ACTION_EVENT: &str = "host-notification-action";
const MAX_NOTIFICATION_TITLE_CHARS: usize = 120;
const MAX_NOTIFICATION_BODY_CHARS: usize = 512;
const MAX_NOTIFICATION_TAG_CHARS: usize = 128;
const MAX_NOTIFICATION_TARGET_CHARS: usize = 256;

#[derive(Debug, Serialize)]
pub struct HostNotificationResponse {
    status: &'static str,
}

#[tauri::command]
pub fn host_external_url_open<R: Runtime>(
    request_id: String,
    url: String,
    app: AppHandle<R>,
) -> Result<(), CommandError> {
    validate_request_id(&request_id)?;
    // 在 Rust 边界复验协议，避免向 Renderer 暴露通用 shell 或 opener capability。
    let url = validate_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostNotificationAction {
    project_id: String,
    task_id: String,
}

#[tauri::command]
pub async fn host_notification_show<R: Runtime>(
    request_id: String,
    title: String,
    body: String,
    tag: String,
    project_id: String,
    task_id: String,
    app: AppHandle<R>,
) -> Result<HostNotificationResponse, CommandError> {
    validate_request_id(&request_id)?;
    validate_notification(&title, &body, &tag, &project_id, &task_id)?;
    let notification = app.notification();
    let permission = match notification.permission_state() {
        Ok(PermissionState::Prompt | PermissionState::PromptWithRationale) => notification
            .request_permission()
            .map_err(|error| CommandError::internal(error.to_string()))?,
        Ok(permission) => permission,
        Err(error) => return Err(CommandError::internal(error.to_string())),
    };
    if permission != PermissionState::Granted {
        return Ok(HostNotificationResponse { status: "denied" });
    }

    #[cfg(target_os = "macos")]
    show_actionable_notification(
        app,
        title,
        body,
        HostNotificationAction {
            project_id,
            task_id,
        },
    );

    #[cfg(not(target_os = "macos"))]
    notification
        .builder()
        .id(notification_id(&tag))
        .title(title)
        .body(body)
        .show()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    Ok(HostNotificationResponse { status: "shown" })
}

fn validate_request_id(request_id: &str) -> Result<(), CommandError> {
    if request_id.trim().is_empty() {
        return Err(CommandError::invalid_input("requestId 不能为空"));
    }
    Ok(())
}

fn validate_external_url(url: &str) -> Result<tauri::Url, CommandError> {
    let parsed = tauri::Url::parse(url)
        .map_err(|_| CommandError::invalid_input("外部链接必须是有效 URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(CommandError::invalid_input("外部链接仅支持 http 或 https"));
    }
    Ok(parsed)
}

fn validate_notification(
    title: &str,
    body: &str,
    tag: &str,
    project_id: &str,
    task_id: &str,
) -> Result<(), CommandError> {
    let valid =
        |value: &str, maximum: usize| !value.trim().is_empty() && value.chars().count() <= maximum;
    if !valid(title, MAX_NOTIFICATION_TITLE_CHARS)
        || !valid(body, MAX_NOTIFICATION_BODY_CHARS)
        || !valid(tag, MAX_NOTIFICATION_TAG_CHARS)
        || !valid(project_id, MAX_NOTIFICATION_TARGET_CHARS)
        || !valid(task_id, MAX_NOTIFICATION_TARGET_CHARS)
    {
        return Err(CommandError::invalid_input("通知内容无效"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn show_actionable_notification<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    body: String,
    action: HostNotificationAction,
) {
    // macOS 插件展示层不暴露点击回调；在阻塞线程等待系统响应，避免占用 Runtime worker。
    let _notification_task = tauri::async_runtime::spawn_blocking(move || {
        let mut notification = mac_notification_sys::Notification::new();
        notification
            .title(&title)
            .message(&body)
            .wait_for_click(true);
        match notification.send() {
            Ok(mac_notification_sys::NotificationResponse::Click) => {
                activate_notification_target(&app, action);
            }
            Ok(_) => {}
            Err(error) => eprintln!("CodeAgent notification failed: {error}"),
        }
    });
}

#[cfg(target_os = "macos")]
fn activate_notification_target<R: Runtime>(app: &AppHandle<R>, action: HostNotificationAction) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to("main", HOST_NOTIFICATION_ACTION_EVENT, action) {
        eprintln!("CodeAgent notification action failed: {error}");
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn notification_id(tag: &str) -> i32 {
    // 使用稳定的 FNV-1a 映射，使同一任务的系统通知可以覆盖更新。
    let hash = tag.as_bytes().iter().fold(2_166_136_261_u32, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(16_777_619)
    });
    i32::from_ne_bytes(hash.to_ne_bytes())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        HostNotificationAction, notification_id, validate_external_url, validate_notification,
        validate_request_id,
    };

    #[test]
    fn serializes_notification_action_target_for_renderer() {
        let action = HostNotificationAction {
            project_id: "project-1".to_owned(),
            task_id: "task-1".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(action).expect("notification action should serialize"),
            json!({ "projectId": "project-1", "taskId": "task-1" })
        );
    }

    #[test]
    fn rejects_invalid_host_command_input() {
        assert!(validate_request_id(" ").is_err());
        assert!(
            validate_notification("CodeAgent", "完成", "task-1", "project-1", "task-1").is_ok()
        );
        assert!(
            validate_notification(
                "CodeAgent",
                &"x".repeat(513),
                "task-1",
                "project-1",
                "task-1"
            )
            .is_err()
        );
        assert_eq!(notification_id("task-1"), notification_id("task-1"));
        assert_ne!(notification_id("task-1"), notification_id("task-2"));
    }

    #[test]
    fn accepts_only_external_web_urls() {
        assert!(validate_external_url("https://example.com/docs").is_ok());
        assert!(validate_external_url("http://example.com").is_ok());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("/relative/path").is_err());
    }
}
