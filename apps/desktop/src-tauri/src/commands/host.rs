use serde::Serialize;
use tauri::{AppHandle, Runtime, plugin::PermissionState};
use tauri_plugin_notification::NotificationExt;

use crate::command_error::CommandError;

const MAX_NOTIFICATION_TITLE_CHARS: usize = 120;
const MAX_NOTIFICATION_BODY_CHARS: usize = 512;
const MAX_NOTIFICATION_TAG_CHARS: usize = 128;

#[derive(Debug, Serialize)]
pub struct HostNotificationResponse {
    status: &'static str,
}

#[tauri::command]
pub async fn host_notification_show<R: Runtime>(
    request_id: String,
    title: String,
    body: String,
    tag: String,
    app: AppHandle<R>,
) -> Result<HostNotificationResponse, CommandError> {
    validate_request_id(&request_id)?;
    validate_notification(&title, &body, &tag)?;
    let notification = app.notification();
    let permission = match notification.permission_state() {
        Ok(PermissionState::Prompt | PermissionState::PromptWithRationale) => notification
            .request_permission()
            .map_err(|_| CommandError::internal("无法请求系统通知权限"))?,
        Ok(permission) => permission,
        Err(_) => return Err(CommandError::internal("无法读取系统通知权限")),
    };
    if permission != PermissionState::Granted {
        return Ok(HostNotificationResponse { status: "denied" });
    }
    notification
        .builder()
        .id(notification_id(&tag))
        .title(title)
        .body(body)
        .show()
        .map_err(|_| CommandError::internal("系统通知发送失败"))?;
    Ok(HostNotificationResponse { status: "shown" })
}

fn validate_request_id(request_id: &str) -> Result<(), CommandError> {
    if request_id.trim().is_empty() {
        return Err(CommandError::invalid_input("requestId 不能为空"));
    }
    Ok(())
}

fn validate_notification(title: &str, body: &str, tag: &str) -> Result<(), CommandError> {
    let valid =
        |value: &str, maximum: usize| !value.trim().is_empty() && value.chars().count() <= maximum;
    if !valid(title, MAX_NOTIFICATION_TITLE_CHARS)
        || !valid(body, MAX_NOTIFICATION_BODY_CHARS)
        || !valid(tag, MAX_NOTIFICATION_TAG_CHARS)
    {
        return Err(CommandError::invalid_input("通知内容无效"));
    }
    Ok(())
}

fn notification_id(tag: &str) -> i32 {
    // 使用稳定的 FNV-1a 映射，使同一任务的系统通知可以覆盖更新。
    let hash = tag.as_bytes().iter().fold(2_166_136_261_u32, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(16_777_619)
    });
    i32::from_ne_bytes(hash.to_ne_bytes())
}

#[cfg(test)]
mod tests {
    use super::{notification_id, validate_notification, validate_request_id};

    #[test]
    fn rejects_invalid_host_command_input() {
        assert!(validate_request_id(" ").is_err());
        assert!(validate_notification("CodeAgent", "完成", "task-1").is_ok());
        assert!(validate_notification("CodeAgent", &"x".repeat(513), "task-1").is_err());
        assert_eq!(notification_id("task-1"), notification_id("task-1"));
        assert_ne!(notification_id("task-1"), notification_id("task-2"));
    }
}
