import type { RunningTaskSnapshot } from "../../protocol/index.js";
import { invoke } from "./native-invoke.js";

export async function getRunningTasks(): Promise<readonly RunningTaskSnapshot[]> {
  return invoke<readonly RunningTaskSnapshot[]>("get_running_tasks");
}
