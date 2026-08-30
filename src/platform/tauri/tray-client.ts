import type { TrayTaskUpdate } from "../../protocol/index.js";
import { invoke } from "./native-invoke.js";

export async function syncTrayTasks(tasks: readonly TrayTaskUpdate[]): Promise<void> {
  await invoke("sync_tray_tasks", { tasks });
}
