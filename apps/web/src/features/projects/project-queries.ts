import { CodeAgentClient } from "@code-agent/client";
import type {
  AgentGlobalSettings,
  AgentProjectDefaults,
  AgentTask,
  AgentTaskPage,
  AgentTaskSnapshot,
  AgentTaskSettings,
  ProjectPage,
} from "@code-agent/protocol";
import {
  infiniteQueryOptions,
  type InfiniteData,
  mutationOptions,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query";

export type CodeAgentReadClient = Pick<CodeAgentClient, "listProjects" | "listTasks" | "readTask">;
export type CodeAgentGitStatusClient = Pick<CodeAgentClient, "getProjectGitStatus">;
export type CodeAgentSourceFileClient = Pick<CodeAgentClient, "readProjectSourceFile">;
export type CodeAgentProjectOpenClient = Pick<
  CodeAgentClient,
  "getProjectOpenCapabilities" | "openProject"
>;
export type CodeAgentRuntimeClient = Pick<
  CodeAgentClient,
  "readTask" | "subscribeEvents" | "unsubscribeTask"
>;
export type CodeAgentBackgroundTerminalClient = Pick<
  CodeAgentClient,
  "listBackgroundTerminals" | "terminateBackgroundTerminal"
>;
export type CodeAgentCapabilitiesClient = Pick<CodeAgentClient, "getCapabilities">;
export type CodeAgentModelsClient = Pick<CodeAgentClient, "listModels">;
export type CodeAgentSkillsClient = Pick<CodeAgentClient, "listSkills">;
export type CodeAgentSettingsClient = Pick<
  CodeAgentClient,
  | "getGlobalSettings"
  | "getProjectDefaults"
  | "updateGlobalSettings"
  | "updateProjectDefaults"
  | "updateTaskSettings"
>;
export type CodeAgentMutationClient = Pick<
  CodeAgentClient,
  | "addProject"
  | "archiveTask"
  | "compactTask"
  | "forkTask"
  | "interruptTurn"
  | "pinTask"
  | "renameTask"
  | "reorderProjects"
  | "startReview"
  | "startTask"
  | "startTurn"
  | "uploadAttachment"
  | "uploadFeedback"
>;
export type CodeAgentRollbackClient = Pick<CodeAgentClient, "rollbackTurn">;
export type CodeAgentPendingRequestClient = Pick<CodeAgentClient, "resolvePendingRequest">;
export type CodeAgentWorkbenchClient = CodeAgentReadClient &
  CodeAgentBackgroundTerminalClient &
  CodeAgentGitStatusClient &
  CodeAgentProjectOpenClient &
  CodeAgentRuntimeClient &
  CodeAgentMutationClient &
  CodeAgentRollbackClient &
  CodeAgentPendingRequestClient &
  CodeAgentCapabilitiesClient &
  CodeAgentModelsClient &
  CodeAgentSkillsClient &
  CodeAgentSettingsClient &
  CodeAgentSourceFileClient;
type CodeAgentSnapshotClient = Pick<CodeAgentClient, "readTask">;

export const PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 1_500;
export const PROJECT_TASK_PAGE_SIZE = 5;
export const PROJECT_TASK_SEARCH_PAGE_SIZE = 100;
export const PROJECT_TASK_SEARCH_SOURCE_KEY = "search-source";
export const TASK_SNAPSHOT_GC_TIME_MS = 30_000;

export const codeAgentClient = new CodeAgentClient();

export type ProjectTaskInfiniteData = InfiniteData<AgentTaskPage, string | undefined>;
type TaskTitleSnapshot = Pick<
  AgentTaskSnapshot,
  "id" | "projectId" | "title" | "turns" | "updatedAt"
>;
type TaskTitleUpdateOptions = Readonly<{
  assistantReplyStarted?: boolean;
}>;

export function flattenProjectTaskPages(currentData: ProjectTaskInfiniteData | undefined) {
  const taskById = new Map<string, AgentTask>();

  for (const page of currentData?.pages ?? []) {
    for (const task of page.data) {
      // 新页可能与旧页边界重叠，首个较新的 Task 版本优先。
      if (!taskById.has(task.id)) {
        taskById.set(task.id, task);
      }
    }
  }

  return [...taskById.values()];
}

export function upsertProjectTaskInInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  task: AgentTask,
): ProjectTaskInfiniteData {
  if (currentData === undefined || currentData.pages.length === 0) {
    return {
      pageParams: [undefined],
      pages: [{ data: [task], nextCursor: null }],
    };
  }

  // Mutation 结果先进入第一页，同时跨页去重并保留服务端 Cursor。
  const pagesWithoutTask = currentData.pages.map((page) => ({
    ...page,
    data: page.data.filter((currentTask) => currentTask.id !== task.id),
  }));
  const firstPage = pagesWithoutTask[0];

  return {
    ...currentData,
    pages: [
      {
        ...firstPage,
        data: [task, ...(firstPage?.data ?? [])],
        nextCursor: firstPage?.nextCursor ?? null,
      },
      ...pagesWithoutTask.slice(1),
    ],
  };
}

export function replaceProjectTaskInInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  task: AgentTask,
): ProjectTaskInfiniteData {
  if (currentData === undefined) {
    return {
      pageParams: [undefined],
      pages: [{ data: [task], nextCursor: null }],
    };
  }

  return {
    ...currentData,
    pages: currentData.pages.map((page) => ({
      ...page,
      data: page.data.map((currentTask) => (currentTask.id === task.id ? task : currentTask)),
    })),
  };
}

export function replaceProjectTaskInQueryCaches(queryClient: QueryClient, task: AgentTask) {
  // 重命名和固定操作必须同步普通分页与已加载的全量搜索源。
  queryClient.setQueryData<ProjectTaskInfiniteData>(
    ["projects", task.projectId, "tasks"],
    (currentData) => replaceProjectTaskInInfiniteData(currentData, task),
  );
  queryClient.setQueryData<readonly AgentTask[]>(
    ["projects", task.projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
    (currentTasks) =>
      currentTasks?.map((currentTask) => (currentTask.id === task.id ? task : currentTask)),
  );
}

function deriveStartedTaskTitle(
  snapshot: TaskTitleSnapshot,
  options: TaskTitleUpdateOptions = {},
): string | undefined {
  // 实时 Delta 已确认回复开始时，不等待可能落后一拍的 HTTP Snapshot 补入 Assistant Item。
  const hasAssistantReply =
    options.assistantReplyStarted === true ||
    snapshot.turns.some((turn) =>
      turn.items.some((item) => item.type === "message" && item.role === "assistant"),
    );
  if (!hasAssistantReply) {
    return undefined;
  }
  if (snapshot.title !== "新聊天") {
    return snapshot.title;
  }

  for (const turn of snapshot.turns) {
    for (const item of turn.items) {
      if (item.type !== "message" || item.role !== "user") {
        continue;
      }
      const firstLine = item.text.trim().split(/\r?\n/u)[0]?.trim();
      if (firstLine) {
        return firstLine;
      }
      const skillName = item.skills?.[0]?.name;
      if (skillName !== undefined) {
        return skillName;
      }
      const attachmentName = item.attachments?.[0]?.name;
      if (attachmentName !== undefined) {
        return attachmentName;
      }
    }
  }
  return "正在回复";
}

export function updateNewTaskTitleFromSnapshotInInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  snapshot: TaskTitleSnapshot,
  options: TaskTitleUpdateOptions = {},
): ProjectTaskInfiniteData | undefined {
  if (currentData === undefined) {
    return undefined;
  }
  const pages = currentData.pages.map((page) => {
    const data = updateNewTaskTitleFromSnapshotInTasks(page.data, snapshot, options);
    if (data === page.data) {
      return page;
    }
    return { ...page, data };
  });
  const hasChanged = pages.some((page, pageIndex) => page !== currentData.pages[pageIndex]);
  return hasChanged ? { ...currentData, pages } : currentData;
}

export function updateNewTaskTitleFromSnapshotInTasks(
  currentTasks: readonly AgentTask[],
  snapshot: TaskTitleSnapshot,
  options: TaskTitleUpdateOptions = {},
): readonly AgentTask[] {
  const title = deriveStartedTaskTitle(snapshot, options);
  if (title === undefined) {
    return currentTasks;
  }
  const taskIndex = currentTasks.findIndex(
    (task) =>
      task.id === snapshot.id && task.projectId === snapshot.projectId && task.title === "新聊天",
  );
  if (taskIndex < 0) {
    return currentTasks;
  }
  return currentTasks.map((task, index) =>
    index === taskIndex ? { ...task, title, updatedAt: snapshot.updatedAt } : task,
  );
}

export function removeProjectTaskFromInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  taskId: string,
): ProjectTaskInfiniteData | undefined {
  if (currentData === undefined) {
    return undefined;
  }

  return {
    ...currentData,
    pages: currentData.pages.map((page) => ({
      ...page,
      data: page.data.filter((task) => task.id !== taskId),
    })),
  };
}

export async function listProjectTasksForSearch(
  projectId: string,
  client: Pick<CodeAgentClient, "listTasks">,
  signal?: AbortSignal,
): Promise<readonly AgentTask[]> {
  const taskById = new Map<string, AgentTask>();
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const pageOptions = {
      ...(cursor === undefined ? {} : { cursor }),
      limit: PROJECT_TASK_SEARCH_PAGE_SIZE,
    };
    const page =
      signal === undefined
        ? await client.listTasks(projectId, pageOptions)
        : await client.listTasks(projectId, pageOptions, { signal });
    for (const task of page.data) {
      // Cursor 页边界可能重叠，保留首次出现的较新任务版本。
      if (!taskById.has(task.id)) {
        taskById.set(task.id, task);
      }
    }

    if (page.nextCursor === null || requestedCursors.has(page.nextCursor)) {
      return [...taskById.values()];
    }
    requestedCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function projectTaskSearchSourceQueryOptions(
  projectId: string,
  enabled: boolean,
  client: Pick<CodeAgentClient, "listTasks"> = codeAgentClient,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) => listProjectTasksForSearch(projectId, client, signal),
    queryKey: ["projects", projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY] as const,
  });
}

export async function removeArchivedProjectTaskAndRefill(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
): Promise<void> {
  const projectTaskQueryKey = ["projects", projectId, "tasks"] as const;
  queryClient.setQueryData<ProjectTaskInfiniteData>(projectTaskQueryKey, (currentData) =>
    removeProjectTaskFromInfiniteData(currentData, taskId),
  );
  queryClient.setQueryData<readonly AgentTask[]>(
    [...projectTaskQueryKey, PROJECT_TASK_SEARCH_SOURCE_KEY],
    (currentTasks) => currentTasks?.filter((task) => task.id !== taskId),
  );

  // 归档会改变服务端 Cursor 边界，重新校准活动页才能稳定补足最近 5 项。
  await queryClient.invalidateQueries({ exact: true, queryKey: projectTaskQueryKey });
}

export function reorderProjectPage(
  currentPage: ProjectPage | undefined,
  projectIds: readonly string[],
): ProjectPage | undefined {
  if (currentPage === undefined) {
    return undefined;
  }
  if (
    currentPage.data.length !== projectIds.length ||
    new Set(projectIds).size !== projectIds.length
  ) {
    return undefined;
  }
  const projectById = new Map(currentPage.data.map((project) => [project.id, project]));
  const reorderedProjects = projectIds.flatMap((projectId) => {
    const project = projectById.get(projectId);
    return project === undefined ? [] : [project];
  });
  if (reorderedProjects.length !== currentPage.data.length) {
    return undefined;
  }
  return { ...currentPage, data: reorderedProjects };
}

type TaskPinMutationInput = Readonly<{
  pinned: boolean;
  projectId: string;
  taskId: string;
}>;

type TaskRenameMutationInput = Readonly<{
  projectId: string;
  taskId: string;
  title: string;
}>;

type TaskArchiveMutationInput = Readonly<{ projectId: string; taskId: string }>;

export function taskPinMutationOptions(client: Pick<CodeAgentClient, "pinTask"> = codeAgentClient) {
  return mutationOptions({
    mutationFn: ({ pinned, projectId, taskId }: TaskPinMutationInput) =>
      client.pinTask(projectId, taskId, pinned),
    mutationKey: ["tasks", "pin"] as const,
  });
}

export function taskRenameMutationOptions(
  client: Pick<CodeAgentClient, "renameTask"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: ({ projectId, taskId, title }: TaskRenameMutationInput) =>
      client.renameTask(projectId, taskId, title),
    mutationKey: ["tasks", "rename"] as const,
  });
}

export function taskArchiveMutationOptions(
  client: Pick<CodeAgentClient, "archiveTask"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: ({ projectId, taskId }: TaskArchiveMutationInput) =>
      client.archiveTask(projectId, taskId),
    mutationKey: ["tasks", "archive"] as const,
  });
}

export function capabilitiesQueryOptions(client: CodeAgentCapabilitiesClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getCapabilities({ signal }),
    queryKey: ["capabilities"] as const,
  });
}

export function modelsQueryOptions(client: CodeAgentModelsClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.listModels({ signal }),
    queryKey: ["models"] as const,
    staleTime: 5 * 60_000,
  });
}

export function globalSettingsQueryOptions(client: CodeAgentSettingsClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getGlobalSettings({ signal }),
    queryKey: ["settings"] as const,
  });
}

export function globalSettingsMutationOptions(client: CodeAgentSettingsClient = codeAgentClient) {
  return mutationOptions({
    mutationFn: (settings: AgentGlobalSettings) => client.updateGlobalSettings(settings),
    mutationKey: ["settings", "update"] as const,
    scope: { id: "global-settings" },
  });
}

export function projectOpenCapabilitiesQueryOptions(
  projectId: string,
  client: CodeAgentProjectOpenClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: ({ signal }) => client.getProjectOpenCapabilities(projectId, { signal }),
    queryKey: ["projects", projectId, "open-capabilities"] as const,
    staleTime: 60_000,
  });
}

export function skillsQueryOptions(
  projectId: string,
  client: CodeAgentSkillsClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: ({ signal }) => client.listSkills(projectId, { signal }),
    queryKey: ["projects", projectId, "skills"] as const,
  });
}

export function projectDefaultsQueryOptions(
  projectId: string,
  client: Pick<CodeAgentClient, "getProjectDefaults"> = codeAgentClient,
) {
  return queryOptions({
    queryFn: ({ signal }) => client.getProjectDefaults(projectId, { signal }),
    queryKey: ["projects", projectId, "defaults"] as const,
  });
}

export function projectDefaultsMutationOptions(
  projectId: string,
  client: Pick<CodeAgentClient, "updateProjectDefaults"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: (settings: AgentProjectDefaults) =>
      client.updateProjectDefaults(projectId, settings),
    mutationKey: ["projects", projectId, "defaults", "update"] as const,
    scope: { id: `project-defaults:${projectId}` },
  });
}

export function taskSettingsMutationOptions(
  projectId: string,
  taskId: string,
  client: Pick<CodeAgentClient, "updateTaskSettings"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: (settings: AgentTaskSettings) =>
      client.updateTaskSettings(projectId, taskId, settings),
    mutationKey: ["projects", projectId, "tasks", taskId, "settings", "update"] as const,
    scope: { id: `task-settings:${projectId}:${taskId}` },
  });
}

export function projectsQueryOptions(client: CodeAgentReadClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.listProjects({ signal }),
    queryKey: ["projects"] as const,
  });
}

export function projectReorderMutationOptions(
  client: Pick<CodeAgentClient, "reorderProjects"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: (projectIds: readonly string[]) => client.reorderProjects(projectIds),
    mutationKey: ["projects", "reorder"] as const,
    scope: { id: "projects:reorder" },
  });
}

export function projectGitStatusRefetchInterval(error: Error | null) {
  return error === null ? PROJECT_GIT_STATUS_POLL_INTERVAL_MS : false;
}

export function projectGitStatusQueryOptions(
  projectId: string,
  isTaskRunning: boolean,
  client: CodeAgentGitStatusClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: ({ signal }) => client.getProjectGitStatus(projectId, { signal }),
    queryKey: ["projects", projectId, "git-status"] as const,
    // 单次检测最多重试一次；最终失败后关闭轮询，手动刷新成功会清空错误并恢复采样。
    refetchInterval: isTaskRunning
      ? (query) => projectGitStatusRefetchInterval(query.state.error)
      : false,
    retry: 1,
  });
}

export function projectTasksInfiniteQueryOptions(
  projectId: string,
  client: CodeAgentReadClient = codeAgentClient,
) {
  return infiniteQueryOptions<
    AgentTaskPage,
    Error,
    ProjectTaskInfiniteData,
    readonly ["projects", string, "tasks"],
    string | undefined
  >({
    getNextPageParam: (
      lastPage: AgentTaskPage,
      _allPages: AgentTaskPage[],
      lastPageParam: string | undefined,
    ) => {
      if (lastPage.nextCursor === null || lastPage.nextCursor === lastPageParam) {
        return undefined;
      }
      return lastPage.nextCursor;
    },
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      client.listTasks(
        projectId,
        {
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          limit: PROJECT_TASK_PAGE_SIZE,
        },
        { signal },
      ),
    queryKey: ["projects", projectId, "tasks"] as const,
  });
}

export function taskSnapshotQueryOptions(
  projectId: string,
  taskId: string,
  client: CodeAgentSnapshotClient = codeAgentClient,
) {
  return queryOptions({
    gcTime: TASK_SNAPSHOT_GC_TIME_MS,
    queryFn: ({ signal }) => client.readTask(projectId, taskId, { signal }),
    queryKey: ["projects", projectId, "tasks", taskId] as const,
  });
}
