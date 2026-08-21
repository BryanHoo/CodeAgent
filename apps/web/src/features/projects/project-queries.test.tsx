import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../shared/components/core/tooltip.js";
import { TaskSnapshotTimeline } from "../workbench/components/task-timeline.js";
import {
  capabilitiesQueryOptions,
  type CodeAgentGitHistoryClient,
  type CodeAgentGitCommitReviewClient,
  type CodeAgentGitStatusClient,
  type CodeAgentFileTreeClient,
  type CodeAgentReadClient,
  type CodeAgentMcpServersClient,
  mcpServersQueryOptions,
  mcpServersReloadMutationOptions,
  modelsQueryOptions,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectGitHistoryInfiniteQueryOptions,
  projectGitCommitFileDiffQueryOptions,
  projectGitCommitFilesInfiniteQueryOptions,
  projectGitStatusQueryOptions,
  projectGitDetailedStatusQueryOptions,
  projectGitRepositoryStatusQueryOptions,
  projectCommitChangesMutationOptions,
  projectCommitMessageMutationOptions,
  projectFileTreeQueryOptions,
  projectReorderMutationOptions,
  listProjectTasksForSearch,
  listPinnedProjectTasks,
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
  upsertProjectInPage,
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
  plan: null,
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
  turnsNextCursor: null,
};

const snapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "runtime-1" },
  snapshot,
};

describe("project queries", () => {
  it("inserts or replaces a worktree project without changing sibling order", () => {
    const worktreeProject = {
      ...project,
      id: "code-agent-worktree",
      name: "CodeAgent-worktree",
      rootPath: "/workspace/CodeAgent-worktree",
    };
    const page = { data: [project], nextCursor: null };

    expect(upsertProjectInPage(undefined, worktreeProject)).toEqual({
      data: [worktreeProject],
      nextCursor: null,
    });
    expect(upsertProjectInPage(page, worktreeProject).data).toEqual([project, worktreeProject]);
    expect(
      upsertProjectInPage(
        { data: [project, worktreeProject], nextCursor: null },
        { ...worktreeProject, name: "Review worktree" },
      ).data,
    ).toEqual([project, { ...worktreeProject, name: "Review worktree" }]);
  });

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

  it("loads shared Project Git status without owning a polling interval", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({
        baseBranches: ["origin/main"],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [],
        unstaged: [],
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitStatusQueryOptions("code-agent", {
      getProjectGitStatus,
    });

    await expect(queryClient.fetchQuery(options)).resolves.toEqual({
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root",
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    });
    expect(options.queryKey).toEqual(["projects", "code-agent", "git-status"]);
    expect(options.refetchInterval).toBeUndefined();
    expect(getProjectGitStatus.mock.calls[0]?.[0]).toBe("code-agent");
    expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({});
    expect(getProjectGitStatus.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("isolates an on-demand detailed Git status by repository and snapshot", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({
        baseBranches: ["origin/main"],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [],
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitDetailedStatusQueryOptions("code-agent", null, "a".repeat(64), true, {
      getProjectGitStatus,
    });

    await queryClient.fetchQuery(options);

    expect(options.queryKey).toEqual([
      "projects",
      "code-agent",
      "git-status-detail",
      null,
      "a".repeat(64),
    ]);
    expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({ includeDiff: true });
  });

  it("loads a selected child repository status into an isolated query", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/frontend",
        branches: ["feat/frontend", "main"],
        repositoryMode: "root",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [],
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitRepositoryStatusQueryOptions("code-agent", "frontend", true, {
      getProjectGitStatus,
    });

    await queryClient.fetchQuery(options);

    expect(options.queryKey).toEqual(["projects", "code-agent", "git-status", "frontend"]);
    expect(getProjectGitStatus.mock.calls[0]?.[0]).toBe("code-agent");
    expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({
      includeDiff: true,
      repository: "frontend",
    });
    expect(getProjectGitStatus.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("loads Git history twenty commits at a time for one repository tab", async () => {
    const commit = {
      authoredAt: "2026-08-06T08:30:00+08:00",
      authorEmail: "developer@example.com",
      authorName: "Developer",
      sha: "a".repeat(40),
      title: "feat(git): 添加历史记录",
    };
    const getProjectGitHistory = vi
      .fn<CodeAgentGitHistoryClient["getProjectGitHistory"]>()
      .mockResolvedValueOnce({
        branch: "release/server",
        commits: [commit],
        nextCursor: "20",
        repositories: ["apps/web", "packages/server"],
        repository: "packages/server",
        repositoryMode: "children",
      })
      .mockResolvedValueOnce({
        branch: "release/server",
        commits: [{ ...commit, sha: "b".repeat(40) }],
        nextCursor: null,
        repositories: ["apps/web", "packages/server"],
        repository: "packages/server",
        repositoryMode: "children",
      });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitHistoryInfiniteQueryOptions("code-agent", "packages/server", true, {
      getProjectGitHistory,
    });
    const observer = new InfiniteQueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);

    await observer.refetch();
    await observer.fetchNextPage();

    expect(options.queryKey).toEqual(["projects", "code-agent", "git-history", "packages/server"]);
    expect(getProjectGitHistory.mock.calls[0]?.slice(0, 2)).toEqual([
      "code-agent",
      { repository: "packages/server" },
    ]);
    expect(getProjectGitHistory.mock.calls[1]?.slice(0, 2)).toEqual([
      "code-agent",
      { cursor: "20", repository: "packages/server" },
    ]);
    expect(getProjectGitHistory.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    expect(
      projectGitHistoryInfiniteQueryOptions("code-agent", undefined, false, {
        getProjectGitHistory,
      }).enabled,
    ).toBe(false);
    unsubscribe();
  });

  it("isolates paginated commit files and selected file Diff queries", async () => {
    const sha = "a".repeat(40);
    const getProjectGitCommitFiles = vi
      .fn<CodeAgentGitCommitReviewClient["getProjectGitCommitFiles"]>()
      .mockResolvedValueOnce({
        files: [{ kind: "update", path: "src/index.ts" }],
        nextCursor: "100",
      })
      .mockResolvedValueOnce({
        files: [{ kind: "create", path: "src/new.ts" }],
        nextCursor: null,
      });
    const getProjectGitCommitFileDiff = vi
      .fn<CodeAgentGitCommitReviewClient["getProjectGitCommitFileDiff"]>()
      .mockResolvedValue({ diff: "@@ -1 +1 @@", truncated: false });
    const client = { getProjectGitCommitFileDiff, getProjectGitCommitFiles };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const filesOptions = projectGitCommitFilesInfiniteQueryOptions(
      "code-agent",
      "packages/server",
      sha,
      true,
      client,
    );
    const observer = new InfiniteQueryObserver(queryClient, filesOptions);
    const unsubscribe = observer.subscribe(() => undefined);

    await observer.refetch();
    await observer.fetchNextPage();
    const diffOptions = projectGitCommitFileDiffQueryOptions(
      "code-agent",
      "packages/server",
      sha,
      "index.ts",
      true,
      client,
    );
    await queryClient.fetchQuery(diffOptions);

    expect(filesOptions.queryKey).toEqual([
      "projects",
      "code-agent",
      "git-commit-files",
      "packages/server",
      sha,
    ]);
    expect(getProjectGitCommitFiles.mock.calls[1]?.[1]).toEqual({
      cursor: "100",
      repository: "packages/server",
      sha,
    });
    expect(diffOptions.queryKey).toEqual([
      "projects",
      "code-agent",
      "git-commit-diff",
      "packages/server",
      sha,
      "index.ts",
    ]);
    expect(getProjectGitCommitFileDiff.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    unsubscribe();
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

  it("loads readable MCP servers with a task-scoped query key", async () => {
    const server = {
      authStatus: "unsupported" as const,
      description: null,
      error: null,
      failureReason: null,
      name: "fast-context",
      status: "ready" as const,
      title: null,
      toolCount: 2,
      version: "1.0.0",
    };
    const listMcpServers = vi.fn<CodeAgentMcpServersClient["listMcpServers"]>(() =>
      Promise.resolve({ data: [server] }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = mcpServersQueryOptions("code-agent", "task-1", { listMcpServers });

    await expect(queryClient.fetchQuery(options)).resolves.toEqual({
      data: [server],
    });
    expect(options.queryKey).toEqual(["projects", "code-agent", "tasks", "task-1", "mcp-servers"]);
    expect(options.refetchInterval).toBeUndefined();
    expect(listMcpServers.mock.calls[0]?.[0]).toBe("code-agent");
    expect(listMcpServers.mock.calls[0]?.[1]).toBe("task-1");
    expect(listMcpServers.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reloads MCP servers through a task-scoped serialized mutation", async () => {
    const response = {
      data: [
        {
          authStatus: null,
          description: null,
          error: null,
          failureReason: null,
          name: "fast-context",
          status: "starting" as const,
          title: null,
          toolCount: 0,
          version: null,
        },
      ],
    };
    const retryMcpServers = vi.fn(() => Promise.resolve(response));
    const queryClient = new QueryClient();
    const options = mcpServersReloadMutationOptions("code-agent", "task-1", {
      retryMcpServers,
    });

    await expect(
      queryClient.getMutationCache().build(queryClient, options).execute(undefined),
    ).resolves.toEqual(response);
    expect(retryMcpServers).toHaveBeenCalledWith("code-agent", "task-1");
    expect(options.scope).toEqual({ id: "task-mcp:code-agent:task-1" });
  });

  it("disables the MCP query when no task is selected", () => {
    const listMcpServers = vi.fn<CodeAgentMcpServersClient["listMcpServers"]>();
    const options = mcpServersQueryOptions("code-agent", undefined, { listMcpServers });

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(["projects", "code-agent", "tasks", null, "mcp-servers"]);
    expect(listMcpServers).not.toHaveBeenCalled();
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
          turns: {
            compact: true,
            interrupt: true,
            review: true,
            start: true,
            steer: true,
          },
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
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
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

    const defaultsMutationOptions = projectDefaultsMutationOptions("code-agent", client);
    const taskMutationOptions = taskSettingsMutationOptions("code-agent", "task-1", client);

    await queryClient
      .getMutationCache()
      .build(queryClient, defaultsMutationOptions)
      .execute(defaults);
    await queryClient.getMutationCache().build(queryClient, taskMutationOptions).execute(settings);

    expect(client.updateProjectDefaults).toHaveBeenCalledWith("code-agent", defaults);
    expect(client.updateTaskSettings).toHaveBeenCalledWith("code-agent", "task-1", settings);
    expect(defaultsMutationOptions.meta).toEqual({
      actionNotification: { successMessage: false },
    });
    expect(taskMutationOptions.meta).toEqual({
      actionNotification: { successMessage: false },
    });
  });

  it("sends the complete project order through a serialized mutation", async () => {
    const reorderProjects = vi.fn(() => Promise.resolve({ data: [project], nextCursor: null }));
    const queryClient = new QueryClient();
    const mutationOptions = projectReorderMutationOptions({ reorderProjects });

    await queryClient.getMutationCache().build(queryClient, mutationOptions).execute([project.id]);

    expect(reorderProjects).toHaveBeenCalledWith([project.id]);
    expect(mutationOptions.scope).toEqual({ id: "projects:reorder" });
  });

  it("generates and commits selected Git paths through project-scoped mutations", async () => {
    const messageRequest = { expectedSnapshot: "a".repeat(64), paths: ["src/app.ts"] };
    const commitRequest = {
      action: "commit" as const,
      expectedSnapshot: "a".repeat(64),
      message: "feat(git): 提交选择文件",
      paths: ["src/app.ts"],
    };
    const client = {
      commitProjectChanges: vi.fn(() =>
        Promise.resolve({
          branch: "feat/commit",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: commitRequest.message,
          pushError: null,
          pushStatus: "not_requested" as const,
        }),
      ),
      generateCommitMessage: vi.fn(() =>
        Promise.resolve({
          message: commitRequest.message,
          snapshot: messageRequest.expectedSnapshot,
        }),
      ),
    };
    const queryClient = new QueryClient();
    const messageOptions = projectCommitMessageMutationOptions("code-agent", client);
    const commitOptions = projectCommitChangesMutationOptions("code-agent", client);

    await queryClient.getMutationCache().build(queryClient, messageOptions).execute(messageRequest);
    await queryClient.getMutationCache().build(queryClient, commitOptions).execute(commitRequest);

    expect(client.generateCommitMessage).toHaveBeenCalledWith("code-agent", messageRequest);
    expect(client.commitProjectChanges).toHaveBeenCalledWith("code-agent", commitRequest);
    expect(messageOptions.scope).toEqual({ id: "project-git-message:code-agent" });
    expect(commitOptions.scope).toEqual({ id: "project-git-mutation:code-agent" });
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

  it("loads only pinned tasks across every pinned page", async () => {
    const secondTask = { ...task, id: "task-2", pinned: true, title: "较早固定任务" };
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ ...task, pinned: true }], nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: [secondTask], nextCursor: null });

    await expect(listPinnedProjectTasks("code-agent", { listTasks })).resolves.toEqual([
      { ...task, pinned: true },
      secondTask,
    ]);
    expect(listTasks).toHaveBeenNthCalledWith(1, "code-agent", { limit: 100, pinned: true });
    expect(listTasks).toHaveBeenNthCalledWith(2, "code-agent", {
      cursor: "next-page",
      limit: 100,
      pinned: true,
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

  it("renders structured items and reasoning summaries without exposing raw reasoning", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <TaskSnapshotTimeline snapshot={snapshot} />
      </TooltipProvider>,
    );

    for (const text of [
      "读取真实历史",
      "模型服务不可用",
      "pnpm check",
      "index.ts",
      "filesystem/read_file",
      "1. 定义协议",
      "上下文压缩",
      "分析协议",
    ]) {
      expect(markup).toContain(text);
    }
    expect(markup).not.toContain("Turn 执行失败");
    expect(markup).not.toContain("输出已截断");
    expect(markup).not.toContain("按统一边界实现");
  });
});
