use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use super::error::AppError;

#[tauri::command]
pub fn show_task_notification(app: AppHandle, title: String, body: String) -> Result<(), AppError> {
    // 通知由宿主进程直接提交给系统通知中心，不让 WebView 构造 Web Notification。
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| AppError::NotificationFailed)
}
