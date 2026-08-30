import { useEffect, useMemo } from "react";

import { syncTrayTasks } from "../../../platform/tauri/tray-client.js";
import { useProjectActivity, useProjectData } from "../../projects/project-context.js";
import { deriveTrayTaskUpdates } from "../tray-tasks.js";

export function TrayTaskSync() {
  const { tasks } = useProjectData();
  const { taskActivity } = useProjectActivity();
  const updates = useMemo(
    () => deriveTrayTaskUpdates(tasks, taskActivity),
    [taskActivity, tasks],
  );

  useEffect(() => {
    // 活动快照变化时才跨 IPC 同步，流式 Delta 不产生额外托盘更新。
    void syncTrayTasks(updates).catch(() => undefined);
  }, [updates]);

  return null;
}
