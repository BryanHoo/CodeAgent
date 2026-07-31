import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TaskSnapshotTimeline } from "../workbench/components/task-timeline.js";
import {
  capabilitiesQueryOptions,
  type CodeAgentGitStatusClient,
  type CodeAgentFileTreeClient,
  type CodeAgentReadClient,
  modelsQueryOptions,
  PROJECT_GIT_STATUS_POLL_INTERVAL_MS,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectGitStatusRefetchInterval,
  projectGitStatusQueryOptions,
  projectFileTreeQueryOptions,
  projectReorderMutationOptions,
  listProjectTasksForSearch,
  projectTasksInfiniteQueryOptions,
  removeArchivedProjectTaskAndRefill,
  type ProjectTaskInfiniteData,
  projectsQueryOptions,
  taskSnapshotQueryOptions,
  taskSettingsMutationOptions,
  updateNewTaskTitleFromSnapshotInInfiniteData,
  flattenProjectTaskPages,
  removeProjectTaskFromInfiniteData,
  reorderProjectPage,
  replaceProjectTaskInInfiniteData,
  upsertProjectTaskInInfiniteData,
} from "./project-queries.js";

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
} as const;

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
} as const;

const snapshot = {
  ...task,
  contextUsage: null,
  pendingRequests: [],
  settings: {
    approvalPolicy: "never" as const,
    approvalsReviewer: "user" as const,
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write" as const,
  },
  status: "idle" as const,
  turns: [
    {
      completedAt: "2026-07-23T00:01:00.000Z",
      error: "模型服务不可用",
      id: "turn-1",
      items: [
        { id: "i1", role: "user" as const, text: "读取真实历史", type: "message" as const },
        {
          content: "按统一边界实现",
          id: "i2",
          summary: "分析协议",
          type: "reasoning" as const,
        },
        {
          command: "pnpm check",
          cwd: "/workspace/CodeAgent",
          id: "i3",
          output: "Done",
          outputTruncated: true,
          status: "completed" as const,
          type: "command" as const,
        },
        {
          changes: [{ diff: "+export {};", kind: "update" as const, path: "src/index.ts" }],
          id: "i4",
          status: "completed" as const,
          type: "file_change" as const,
        },
        {
          id: "i5",
          input: { path: "src/index.ts" },
          name: "filesystem/read_file",
          status: "completed" as const,
          type: "tool" as const,
        },
        { id: "i6", text: "1. 定义协议", type: "plan" as const },
        { detail: "完成压缩", id: "i7", label: "上下文压缩", type: "activity" as const },
      ],
      startedAt: "2026-07-23T00:00:00.000Z",
      status: "failed" as const,
    },
  ],
};

const snapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "runtime-1" },
  snapshot,
};

describe("project queries", () => {
  it("inserts a created task immediately and replaces it when fresh metadata arrives", () => {
    const initialData = {
      pageParams: [undefined, "next-page"],
      pages: [
        { data: [task], nextCursor: "next-page" },
        { data: [{ ...task, id: "task-older" }], nextCursor: null },
      ],
    };
    const createdTask = {
      ...task,
      id: "task-created",
      title: "新聊天",
      updatedAt: "2026-07-26T08:00:00.000Z",
    };
    const materializedTask = { ...createdTask, title: "发送你好" };

    const insertedData = upsertProjectTaskInInfiniteData(initialData, createdTask);
    const refreshedData = upsertProjectTaskInInfiniteData(insertedData, materializedTask);

    expect(flattenProjectTaskPages(insertedData)).toEqual([
      createdTask,
      task,
      { ...task, id: "task-older" },
    ]);
    expect(flattenProjectTaskPages(refreshedData)).toEqual([
      materializedTask,
      task,
      { ...task, id: "task-older" },
    ]);
    expect(refreshedData).toMatchObject({
      pageParams: [undefined, "next-page"],
      pages: [{ nextCursor: "next-page" }, { nextCursor: null }],
    });
  });

  it("replaces and removes task metadata without changing sibling order", () => {
    const sibling = { ...task, id: "task-2", title: "Sibling" };
    const infiniteData = {
      pageParams: [undefined, "next-page"],
      pages: [
        { data: [sibling], nextCursor: "next-page" },
        { data: [task], nextCursor: null },
      ],
    };

    const replacedData = replaceProjectTaskInInfiniteData(infiniteData, {
      ...task,
      pinned: true,
    });
    const removedData = removeProjectTaskFromInfiniteData(infiniteData, task.id);

    expect(flattenProjectTaskPages(replacedData)).toEqual([sibling, { ...task, pinned: true }]);
    expect(flattenProjectTaskPages(removedData)).toEqual([sibling]);
    expect(removedData).toMatchObject({
      pageParams: [undefined, "next-page"],
      pages: [{ nextCursor: "next-page" }, { nextCursor: null }],
    });
  });

  it("reorders a complete project page and rejects stale project sets", () => {
    const secondProject = { ...project, id: "superwork", name: "superwork" };
    const page = { data: [project, secondProject], nextCursor: null };

    expect(reorderProjectPage(page, [secondProject.id, project.id])).toEqual({
      data: [secondProject, project],
      nextCursor: null,
    });
    expect(reorderProjectPage(page, [project.id])).toBeUndefined();
    expect(reorderProjectPage(page, [project.id, "missing"])).toBeUndefined();
    expect(reorderProjectPage(page, [project.id, project.id])).toBeUndefined();
  });

  it("polls Git status only while the current task is running", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({ baseBranches: ["origin/main"], branch: "main", staged: [], unstaged: [] }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const runningOptions = projectGitStatusQueryOptions("code-agent", true, {
      getProjectGitStatus,
    });
    const idleOptions = projectGitStatusQueryOptions("code-agent", false, {
      getProjectGitStatus,
    });

    await expect(queryClient.fetchQuery(runningOptions)).resolves.toEqual({
      baseBranches: ["origin/main"],
      branch: "main",
      staged: [],
      unstaged: [],
    });
    expect(runningOptions.refetchInterval).toBeTypeOf("function");
    expect(idleOptions.refetchInterval).toBe(false);
    expect(getProjectGitStatus.mock.calls[0]?.[0]).toBe("code-agent");
    expect(getProjectGitStatus.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("loads a project-scoped file tree directory with query cancellation", async () => {
    const listProjectFiles = vi.fn<CodeAgentFileTreeClient["listProjectFiles"]>(() =>
      Promise.resolve({
        entries: [{ path: "src/components", type: "directory" }],
        path: "src",
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectFileTreeQueryOptions("code-agent", "src", { listProjectFiles });

    await expect(queryClient.fetchQuery(options)).resolves.toEqual({
      entries: [{ path: "src/components", type: "directory" }],
      path: "src",
    });
    expect(options.queryKey).toEqual(["projects", "code-agent", "file-tree", "src"]);
    expect(listProjectFiles.mock.calls[0]?.[0]).toBe("code-agent");
    expect(listProjectFiles.mock.calls[0]?.[1]).toBe("src");
    expect(listProjectFiles.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("stops failed Git polling until a manual refresh succeeds", () => {
    const gitStatus = {
      baseBranches: ["origin/main"],
      branch: "main",
      staged: [],
      unstaged: [],
    };
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve(gitStatus),
    );
    const options = projectGitStatusQueryOptions("code-agent", true, { getProjectGitStatus });

    expect(options.refetchInterval).toBeTypeOf("function");
    expect(projectGitStatusRefetchInterval(new Error("not a git repository"))).toBe(false);
    expect(projectGitStatusRefetchInterval(null)).toBe(PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
  });

  it("loads projects, project tasks, and task snapshots through the client", async () => {
    const readTask = vi.fn<CodeAgentReadClient["readTask"]>(() =>
      Promise.resolve(snapshotResponse),
    );
    const client = {
      getCapabilities: vi.fn(() =>
        Promise.resolve({
          feedback: { upload: true },
          provider: "codex",
          skills: { list: true, use: true },
          tasks: { fork: true, list: true, read: true, start: true },
          turns: { compact: true, interrupt: true, review: true, rollback: true, start: true },
        }),
      ),
      getProjectDefaults: vi.fn(() =>
        Promise.resolve({
          settings: {
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            sandboxMode: "workspace-write" as const,
          },
        }),
      ),
      listProjects: vi.fn(() => Promise.resolve({ data: [project], nextCursor: null })),
      listModels: vi.fn(() =>
        Promise.resolve({
          data: [
            {
              defaultReasoningEffort: "high",
              description: "适合复杂编码任务",
              displayName: "GPT-5.6 Sol",
              id: "gpt-5.6-sol",
              isDefault: true,
              supportedReasoningEfforts: [{ description: "深入分析", id: "high" }],
            },
          ],
          nextCursor: null,
        }),
      ),
      listTasks: vi.fn(() => Promise.resolve({ data: [task], nextCursor: null })),
      readTask,
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(queryClient.fetchQuery(projectsQueryOptions(client))).resolves.toEqual({
      data: [project],
      nextCursor: null,
    });
    await expect(queryClient.fetchQuery(capabilitiesQueryOptions(client))).resolves.toMatchObject({
      feedback: { upload: true },
      tasks: { fork: true, start: true },
      turns: { compact: true, interrupt: true, review: true, rollback: true, start: true },
    });
    await expect(queryClient.fetchQuery(modelsQueryOptions(client))).resolves.toMatchObject({
      data: [{ id: "gpt-5.6-sol", isDefault: true }],
    });
    await expect(
      queryClient.fetchQuery(projectDefaultsQueryOptions("code-agent", client)),
    ).resolves.toEqual({
      settings: {
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
    });
    await expect(
      queryClient.fetchInfiniteQuery(projectTasksInfiniteQueryOptions("code-agent", client)),
    ).resolves.toEqual({ pageParams: [undefined], pages: [{ data: [task], nextCursor: null }] });
    await expect(
      queryClient.fetchQuery(taskSnapshotQueryOptions("code-agent", "task-1", client)),
    ).resolves.toEqual(snapshotResponse);
    expect(readTask.mock.calls[0]?.slice(0, 2)).toEqual(["code-agent", "task-1"]);
    expect(readTask.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("updates complete project defaults and task settings through mutations", async () => {
    const defaults = {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write" as const,
    };
    const settings = {
      approvalPolicy: "never" as const,
      approvalsReviewer: "user" as const,
      ...defaults,
    };
    const client = {
      updateProjectDefaults: vi.fn(() => Promise.resolve({ settings: defaults })),
      updateTaskSettings: vi.fn(() => Promise.resolve({ settings })),
    };
    const queryClient = new QueryClient();

    await queryClient
      .getMutationCache()
      .build(queryClient, projectDefaultsMutationOptions("code-agent", client))
      .execute(defaults);
    await queryClient
      .getMutationCache()
      .build(queryClient, taskSettingsMutationOptions("code-agent", "task-1", client))
      .execute(settings);

    expect(client.updateProjectDefaults).toHaveBeenCalledWith("code-agent", defaults);
    expect(client.updateTaskSettings).toHaveBeenCalledWith("code-agent", "task-1", settings);
  });

  it("sends the complete project order through a serialized mutation", async () => {
    const reorderProjects = vi.fn(() => Promise.resolve({ data: [project], nextCursor: null }));
    const queryClient = new QueryClient();
    const mutationOptions = projectReorderMutationOptions({ reorderProjects });

    await queryClient.getMutationCache().build(queryClient, mutationOptions).execute([project.id]);

    expect(reorderProjects).toHaveBeenCalledWith([project.id]);
    expect(mutationOptions.scope).toEqual({ id: "projects:reorder" });
  });

  it("loads only the first task page until the next page is explicitly requested", async () => {
    const nextTask = { ...task, id: "task-2", title: "后续分页任务" };
    const listTasks = vi
      .fn<CodeAgentReadClient["listTasks"]>()
      .mockResolvedValueOnce({ data: [task], nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: [nextTask], nextCursor: null });
    const client = {
      listProjects: vi.fn(() => Promise.resolve({ data: [project], nextCursor: null })),
      listTasks,
      readTask: vi.fn(() => Promise.resolve(snapshotResponse)),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const queryOptions = projectTasksInfiniteQueryOptions("code-agent", client);
    const queryObserver = new InfiniteQueryObserver(queryClient, queryOptions);
    const unsubscribe = queryObserver.subscribe(() => undefined);

    await expect(queryObserver.refetch()).resolves.toMatchObject({
      data: {
        pageParams: [undefined],
        pages: [{ data: [task], nextCursor: "next-page" }],
      },
    });
    expect(queryClient.getQueryData(queryOptions.queryKey)).toEqual({
      pageParams: [undefined],
      pages: [{ data: [task], nextCursor: "next-page" }],
    });
    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(listTasks.mock.calls[0]?.slice(0, 2)).toEqual(["code-agent", { limit: 5 }]);
    expect(listTasks.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);

    await expect(queryObserver.fetchNextPage()).resolves.toMatchObject({
      data: {
        pageParams: [undefined, "next-page"],
        pages: [
          { data: [task], nextCursor: "next-page" },
          { data: [nextTask], nextCursor: null },
        ],
      },
    });
    expect(listTasks.mock.calls[1]?.slice(0, 2)).toEqual([
      "code-agent",
      {
        cursor: "next-page",
        limit: 5,
      },
    ]);
    expect(listTasks.mock.calls[1]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    unsubscribe();
  });

  it("loads every task page for search and removes overlapping tasks", async () => {
    const secondTask = { ...task, id: "task-2", title: "完整搜索结果" };
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ data: [task], nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: [task, secondTask], nextCursor: null });

    await expect(listProjectTasksForSearch("code-agent", { listTasks })).resolves.toEqual([
      task,
      secondTask,
    ]);
    expect(listTasks).toHaveBeenNthCalledWith(1, "code-agent", { limit: 100 });
    expect(listTasks).toHaveBeenNthCalledWith(2, "code-agent", {
      cursor: "next-page",
      limit: 100,
    });
  });

  it("refetches the active first page after archive to keep five recent tasks visible", async () => {
    const initialTasks = Array.from({ length: 5 }, (_, index) => ({
      ...task,
      id: `task-${String(index + 1)}`,
      title: `Task ${String(index + 1)}`,
    }));
    const replenishedTasks = [...initialTasks.slice(1), { ...task, id: "task-6", title: "Task 6" }];
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ data: initialTasks, nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: replenishedTasks, nextCursor: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryOptions = projectTasksInfiniteQueryOptions("code-agent", {
      listProjects: vi.fn(),
      listTasks,
      readTask: vi.fn(),
    });
    const queryObserver = new InfiniteQueryObserver(queryClient, queryOptions);
    const unsubscribe = queryObserver.subscribe(() => undefined);
    await queryObserver.refetch();
    queryClient.setQueryData(["projects", "code-agent", "tasks", "search-source"], initialTasks);

    await removeArchivedProjectTaskAndRefill(queryClient, "code-agent", "task-1");

    expect(flattenProjectTaskPages(queryClient.getQueryData(queryOptions.queryKey))).toEqual(
      replenishedTasks,
    );
    expect(queryClient.getQueryData(["projects", "code-agent", "tasks", "search-source"])).toEqual(
      initialTasks.slice(1),
    );
    expect(listTasks).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("replaces the new-chat title when the first assistant reply starts", () => {
    const newTask = { ...task, title: "新聊天" };
    const currentData = {
      pageParams: [undefined],
      pages: [{ data: [newTask], nextCursor: null }],
    } satisfies ProjectTaskInfiniteData;
    const runningSnapshot = {
      ...snapshot,
      status: "running" as const,
      title: "新聊天",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "user-message",
              role: "user" as const,
              text: "修复停止回复后内容消失\n并更新标题",
              type: "message" as const,
            },
            {
              id: "assistant-message",
              role: "assistant" as const,
              text: "我来检查。",
              type: "message" as const,
            },
          ],
          startedAt: snapshot.updatedAt,
          status: "running" as const,
        },
      ],
    };

    expect(updateNewTaskTitleFromSnapshotInInfiniteData(currentData, runningSnapshot)).toEqual({
      pageParams: [undefined],
      pages: [
        {
          data: [{ ...newTask, title: "修复停止回复后内容消失" }],
          nextCursor: null,
        },
      ],
    });
  });

  it("uses the realtime assistant-start signal when the HTTP snapshot is one event behind", () => {
    const newTask = { ...task, title: "新聊天" };
    const currentData = {
      pageParams: [undefined],
      pages: [{ data: [newTask], nextCursor: null }],
    } satisfies ProjectTaskInfiniteData;
    const laggingSnapshot = {
      ...snapshot,
      status: "running" as const,
      title: "新聊天",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "user-message",
              role: "user" as const,
              text: "修复后台任务标题同步\n处理流式竞态",
              type: "message" as const,
            },
          ],
          startedAt: snapshot.updatedAt,
          status: "running" as const,
        },
      ],
    };

    expect(
      updateNewTaskTitleFromSnapshotInInfiniteData(currentData, laggingSnapshot, {
        assistantReplyStarted: true,
      }),
    ).toEqual({
      pageParams: [undefined],
      pages: [
        {
          data: [{ ...newTask, title: "修复后台任务标题同步" }],
          nextCursor: null,
        },
      ],
    });
  });

  it("stops pagination when the provider repeats the current cursor", () => {
    const queryOptions = projectTasksInfiniteQueryOptions("code-agent", {
      listProjects: vi.fn(),
      listTasks: vi.fn(),
      readTask: vi.fn(),
    });
    const repeatedCursorPage = { data: [task], nextCursor: "same-cursor" };

    expect(
      queryOptions.getNextPageParam(repeatedCursorPage, [repeatedCursorPage], "same-cursor", [
        "same-cursor",
      ]),
    ).toBeUndefined();
  });

  it("renders user-visible structured items without exposing reasoning", () => {
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={snapshot} />);

    for (const text of [
      "读取真实历史",
      "Turn 执行失败",
      "模型服务不可用",
      "pnpm check",
      "输出已截断",
      "src/index.ts",
      "filesystem/read_file",
      "1. 定义协议",
      "上下文压缩",
    ]) {
      expect(markup).toContain(text);
    }
    expect(markup).not.toContain("分析协议");
    expect(markup).not.toContain("按统一边界实现");
  });
});
