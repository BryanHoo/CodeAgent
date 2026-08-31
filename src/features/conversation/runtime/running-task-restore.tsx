import { useEffect } from "react";

import { getRunningTasks } from "../../../platform/tauri/running-task-client.js";
import { useProjectActions } from "../../projects/project-context.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";

export function RunningTaskRestore() {
  const { projectRuntime } = useProjectActions();

  useEffect(() => {
    let active = true;
    void getRunningTasks()
      .then((tasks) => (active ? projectRuntime.restoreRunningTasks(tasks) : undefined))
      .catch((error: unknown) => {
        recordInternalWarning("running_task_restore_failed", error);
      });
    return () => {
      active = false;
    };
  }, [projectRuntime]);

  return null;
}
