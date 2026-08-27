export type TaskStatus = "completed" | "running" | "waiting";

export type WorkbenchTask = Readonly<{
  id: string;
  pinned?: boolean;
  projectId: string;
  status: TaskStatus;
  time: string;
  title: string;
}>;

export type WorkbenchProject = Readonly<{
  id: string;
  name: string;
  tasks: readonly WorkbenchTask[];
}>;

export const PROJECTS: readonly WorkbenchProject[] = [
  {
    id: "codeagent",
    name: "CodeAgent",
    tasks: [
      {
        id: "task-1",
        pinned: true,
        projectId: "codeagent",
        status: "running",
        time: "2m",
        title: "借鉴 Codexly 完善工作台",
      },
      {
        id: "task-2",
        pinned: true,
        projectId: "codeagent",
        status: "completed",
        time: "18m",
        title: "建立全局设计 tokens",
      },
      {
        id: "task-3",
        projectId: "codeagent",
        status: "waiting",
        time: "1h",
        title: "梳理 Tauri 运行时事件",
      },
      {
        id: "task-4",
        projectId: "codeagent",
        status: "completed",
        time: "1d",
        title: "优化前端状态投影性能",
      },
    ],
  },
  {
    id: "superwork",
    name: "superwork",
    tasks: [
      {
        id: "task-5",
        projectId: "superwork",
        status: "completed",
        time: "2h",
        title: "更新技能路由和执行规范",
      },
      {
        id: "task-6",
        projectId: "superwork",
        status: "completed",
        time: "3h",
        title: "补充工作流校验文档",
      },
    ],
  },
  { id: "codex", name: "codex", tasks: [] },
];

export const ALL_TASKS = PROJECTS.flatMap((project) => project.tasks);

export const FILE_TREE = [
  { depth: 0, kind: "folder", name: "CodeAgent", open: true },
  { depth: 1, kind: "folder", name: ".superwork", open: false },
  { depth: 1, kind: "folder", name: "public", open: false },
  { depth: 1, kind: "folder", name: "src", open: true },
  { depth: 2, kind: "folder", name: "app", open: true },
  { depth: 3, kind: "file", name: "app-shell.tsx" },
  { depth: 3, kind: "file", name: "chat-workspace.tsx" },
  { depth: 3, kind: "file", name: "project-panel.tsx" },
  { depth: 3, kind: "file", name: "task-sidebar.tsx" },
  { depth: 2, kind: "folder", name: "components", open: false },
  { depth: 2, kind: "folder", name: "styles", open: false },
  { depth: 1, kind: "folder", name: "src-tauri", open: false },
  { depth: 1, kind: "file", name: "package.json" },
  { depth: 1, kind: "file", name: "pnpm-lock.yaml" },
  { depth: 1, kind: "file", name: "vite.config.ts" },
] as const;

export const CHANGES = [
  { additions: 184, deletions: 42, path: "src/app/app-shell.tsx", status: "M" },
  { additions: 126, deletions: 88, path: "src/styles/globals.css", status: "M" },
  { additions: 96, deletions: 0, path: "src/app/workbench-state.ts", status: "A" },
] as const;

export function getTask(taskId: string) {
  return ALL_TASKS.find((task) => task.id === taskId) ?? ALL_TASKS[0];
}
