use serde::Serialize;
use tauri::{AppHandle, Runtime, plugin::PermissionState};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::oneshot;

use crate::command_error::CommandError;

const MAX_SELECTED_FILES: usize = 20;
const MAX_NOTIFICATION_TITLE_CHARS: usize = 120;
const MAX_NOTIFICATION_BODY_CHARS: usize = 512;
const MAX_NOTIFICATION_TAG_CHARS: usize = 128;

#[derive(Debug, Serialize)]
pub struct HostDirectorySelectionResponse {
    path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HostFileSelectionResponse {
    paths: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct HostNotificationResponse {
    status: &'static str,
}

#[tauri::command]
pub async fn host_directory_select<R: Runtime>(
    request_id: String,
    app: AppHandle<R>,
) -> Result<HostDirectorySelectionResponse, CommandError> {
    validate_request_id(&request_id)?;
    let (sender, receiver) = oneshot::channel();
    app.dialog().file().pick_folder(move |selection| {
        let _ = sender.send(selection.and_then(file_path_to_string));
    });
    let path = receiver
        .await
        .map_err(|_| CommandError::internal("目录选择器意外关闭"))?;
    Ok(HostDirectorySelectionResponse { path })
}

#[tauri::command]
pub async fn host_files_select<R: Runtime>(
    request_id: String,
    kind: String,
    app: AppHandle<R>,
) -> Result<HostFileSelectionResponse, CommandError> {
    validate_request_id(&request_id)?;
    let mut dialog = app.dialog().file().set_title("选择附件");
    dialog = match kind.as_str() {
        "image" => dialog.add_filter("图片", &["gif", "jpeg", "jpg", "png", "webp"]),
        "file" => dialog.add_filter(
            "文档",
            &[
                "csv", "doc", "docx", "html", "json", "md", "pdf", "ppt", "pptx", "txt", "xls",
                "xlsx", "xml", "yaml", "yml",
            ],
        ),
        _ => return Err(CommandError::invalid_input("附件类型无效")),
    };
    let (sender, receiver) = oneshot::channel();
    dialog.pick_files(move |selection| {
        let paths = selection
            .unwrap_or_default()
            .into_iter()
            .take(MAX_SELECTED_FILES)
            .filter_map(file_path_to_string)
            .collect();
        let _ = sender.send(paths);
    });
    let paths = receiver
        .await
        .map_err(|_| CommandError::internal("文件选择器意外关闭"))?;
    Ok(HostFileSelectionResponse { paths })
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

fn file_path_to_string(path: FilePath) -> Option<String> {
    path.into_path()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
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
