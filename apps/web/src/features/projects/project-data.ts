import type { AgentTask } from "@code-agent/protocol";

export const PROJECT_TASK_PREVIEW_LIMIT = 5;

export function getPinnedTasks(tasks: readonly AgentTask[]) {
  return tasks.filter((task) => task.pinned);
}

export function getProjectTaskPreview(tasks: readonly AgentTask[], expanded: boolean) {
  if (expanded || tasks.length <= PROJECT_TASK_PREVIEW_LIMIT) {
    return { hasMore: false, tasks } as const;
  }
  return { hasMore: true, tasks: tasks.slice(0, PROJECT_TASK_PREVIEW_LIMIT) } as const;
}

export function formatTaskAge(updatedAt: string) {
  const elapsedHours = Math.max(1, Math.floor((Date.now() - Date.parse(updatedAt)) / 3_600_000));

  if (elapsedHours < 24) {
    return `${String(elapsedHours)}h`;
  }
  return `${String(Math.floor(elapsedHours / 24))}d`;
}
