import type { AgentTask } from "@code-agent/protocol";

export function getPinnedTasks(tasks: readonly AgentTask[]) {
  return tasks.filter((task) => task.pinned);
}

export function formatTaskAge(updatedAt: string) {
  const elapsedHours = Math.max(1, Math.floor((Date.now() - Date.parse(updatedAt)) / 3_600_000));

  if (elapsedHours < 24) {
    return `${String(elapsedHours)}h`;
  }
  return `${String(Math.floor(elapsedHours / 24))}d`;
}
