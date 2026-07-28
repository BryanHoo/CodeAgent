import { CodeAgentClient } from "@code-agent/client";
import type {
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
  "getProjectDefaults" | "updateProjectDefaults" | "updateTaskSettings"
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

function deriveStartedTaskTitle(snapshot: TaskTitleSnapshot): string | undefined {
  const hasAssistantReply = snapshot.turns.some((turn) =>
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
): ProjectTaskInfiniteData | undefined {
  if (currentData === undefined) {
    return undefined;
  }
  const title = deriveStartedTaskTitle(snapshot);
  if (title === undefined) {
    return currentData;
  }

  const hasNewTask = currentData.pages.some((page) =>
    page.data.some(
      (task) =>
        task.id === snapshot.id && task.projectId === snapshot.projectId && task.title === "新聊天",
    ),
  );
  if (!hasNewTask) {
    return currentData;
  }
  const pages = currentData.pages.map((page) => ({
    ...page,
    data: page.data.map((task) => {
      if (
        task.id !== snapshot.id ||
        task.projectId !== snapshot.projectId ||
        task.title !== "新聊天"
      ) {
        return task;
      }
      return { ...task, title, updatedAt: snapshot.updatedAt };
    }),
  }));
  return { ...currentData, pages };
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
): Promise<readonly AgentTask[]> {
  const taskById = new Map<string, AgentTask>();
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const page = await client.listTasks(projectId, {
      ...(cursor === undefined ? {} : { cursor }),
      limit: PROJECT_TASK_SEARCH_PAGE_SIZE,
    });
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
    queryFn: () => listProjectTasksForSearch(projectId, client),
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
    queryFn: () => client.getCapabilities(),
    queryKey: ["capabilities"] as const,
  });
}

export function modelsQueryOptions(client: CodeAgentModelsClient = codeAgentClient) {
  return queryOptions({
    queryFn: () => client.listModels(),
    queryKey: ["models"] as const,
    staleTime: 5 * 60_000,
  });
}

export function skillsQueryOptions(
  projectId: string,
  client: CodeAgentSkillsClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => client.listSkills(projectId),
    queryKey: ["projects", projectId, "skills"] as const,
  });
}

export function projectDefaultsQueryOptions(
  projectId: string,
  client: Pick<CodeAgentClient, "getProjectDefaults"> = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => client.getProjectDefaults(projectId),
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
    queryFn: () => client.listProjects(),
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

export function projectGitStatusQueryOptions(
  projectId: string,
  isTaskRunning: boolean,
  client: CodeAgentGitStatusClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => client.getProjectGitStatus(projectId),
    queryKey: ["projects", projectId, "git-status"] as const,
    // Agent 运行时持续采样工作区；空闲时仍保留首次读取和窗口聚焦重验证。
    refetchInterval: isTaskRunning ? PROJECT_GIT_STATUS_POLL_INTERVAL_MS : false,
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
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      client.listTasks(projectId, {
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
        limit: PROJECT_TASK_PAGE_SIZE,
      }),
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
    queryFn: () => client.readTask(projectId, taskId),
    queryKey: ["projects", projectId, "tasks", taskId] as const,
  });
}
