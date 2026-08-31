import { useEffect } from "react";

import { getTaskActivities } from "../../../platform/tauri/task-activity-client.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import { useProjectActions } from "../../projects/project-context.js";

export function TaskActivityRestore() {
  const { projectRuntime } = useProjectActions();

  useEffect(() => {
    let active = true;
    void getTaskActivities()
      .then((tasks) => (active ? projectRuntime.restoreTaskActivities(tasks) : undefined))
      .catch((error: unknown) => {
        recordInternalWarning("task_activity_restore_failed", error);
      });
    return () => {
      active = false;
    };
  }, [projectRuntime]);

  return null;
}
