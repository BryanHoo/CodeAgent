import type { AgentTask, TrayTaskUpdate } from "@/protocol/index.js";

import type { TaskActivityMap } from "../conversation/runtime/task-activity.js";

const MAX_TRAY_TASK_UPDATES = 256;

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

export function deriveTrayTaskUpdates(
  tasks: readonly Pick<AgentTask, "id" | "projectId" | "title">[],
  activity: TaskActivityMap,
): readonly TrayTaskUpdate[] {
  const taskNames = new Map(tasks.map((task) => [taskKey(task.projectId, task.id), task.title]));
  const records = [...activity.values()];
  const selectedRecords = [
    ...records.filter((record) => record.isRunning),
    ...records.filter((record) => !record.isRunning),
  ].slice(0, MAX_TRAY_TASK_UPDATES);

  // 运行任务优先占用有界载荷；终态记录用于增量移除，不会用空快照覆盖 Rust 状态。
  return selectedRecords.map((record) => ({
    isRunning: record.isRunning,
    projectId: record.projectId,
    taskId: record.taskId,
    taskName: taskNames.get(taskKey(record.projectId, record.taskId)) ?? record.taskId,
  }));
}
