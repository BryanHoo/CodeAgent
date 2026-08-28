import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type DesktopNotification = Readonly<{
  body: string;
  title: string;
}>;

type NotificationInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export async function showDesktopNotification(
  notification: DesktopNotification,
  invoke: NotificationInvoke = tauriInvoke,
): Promise<void> {
  // 统一经过受限 IPC，由 Rust 调用系统通知中心，避免退回 Web Notification API。
  await invoke("show_task_notification", notification);
}
