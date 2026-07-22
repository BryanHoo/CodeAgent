import type { AgentTask, Project } from "@code-agent/protocol";

export const initialProjects: readonly Project[] = [
  {
    createdAt: "2026-07-22T06:00:00.000Z",
    id: "code-agent",
    name: "CodeAgent",
    rootPath: "~/Develop/person/CodeAgent",
  },
  {
    createdAt: "2026-07-22T06:30:00.000Z",
    id: "superwork",
    name: "superwork",
    rootPath: "~/Develop/person/superwork",
  },
];

export const initialTasks: readonly AgentTask[] = [
  {
    id: "task-1",
    pinned: true,
    projectId: "code-agent",
    title: "构建 macOS 工作台",
    updatedAt: "2026-07-22T07:58:00.000Z",
  },
  {
    id: "input-design",
    pinned: false,
    projectId: "code-agent",
    title: "优化输入框交互",
    updatedAt: "2026-07-22T06:00:00.000Z",
  },
  {
    id: "model-api",
    pinned: false,
    projectId: "code-agent",
    title: "接入模型选择 API",
    updatedAt: "2026-07-21T08:00:00.000Z",
  },
  {
    id: "markdown",
    pinned: false,
    projectId: "code-agent",
    title: "完善 Markdown 渲染",
    updatedAt: "2026-07-20T08:00:00.000Z",
  },
  {
    id: "project-security",
    pinned: false,
    projectId: "superwork",
    title: "收敛项目路径安全边界",
    updatedAt: "2026-07-22T05:00:00.000Z",
  },
  {
    id: "plan-check",
    pinned: false,
    projectId: "superwork",
    title: "优化计划预检反馈",
    updatedAt: "2026-07-21T09:00:00.000Z",
  },
];

export function getPinnedTasks(tasks: readonly AgentTask[]) {
  return tasks.filter((task) => task.pinned);
}

export function createProjectId(folderName: string, existingIds: readonly string[]) {
  const normalized = folderName
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseId = normalized.length > 0 ? normalized : "project";
  const ids = new Set(existingIds);

  if (!ids.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (ids.has(`${baseId}-${String(suffix)}`)) {
    suffix += 1;
  }
  return `${baseId}-${String(suffix)}`;
}

export function formatTaskAge(updatedAt: string) {
  const elapsedHours = Math.max(1, Math.floor((Date.now() - Date.parse(updatedAt)) / 3_600_000));

  if (elapsedHours < 24) {
    return `${String(elapsedHours)}h`;
  }
  return `${String(Math.floor(elapsedHours / 24))}d`;
}
