import { CodeAgentClient } from "@code-agent/client";
import type {
  AgentProjectDefaults,
  AgentTask,
  AgentTaskPage,
  AgentTaskSettings,
} from "@code-agent/protocol";
import { mutationOptions, queryOptions } from "@tanstack/react-query";

export type CodeAgentReadClient = Pick<CodeAgentClient, "listProjects" | "listTasks" | "readTask">;
export type CodeAgentGitStatusClient = Pick<CodeAgentClient, "getProjectGitStatus">;
export type CodeAgentSourceFileClient = Pick<CodeAgentClient, "readProjectSourceFile">;
export type CodeAgentRuntimeClient = Pick<CodeAgentClient, "readTask" | "subscribeEvents">;
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
  | "startReview"
  | "startTask"
  | "startTurn"
  | "uploadAttachment"
  | "uploadFeedback"
>;
export type CodeAgentRollbackClient = Pick<CodeAgentClient, "rollbackTurn">;
export type CodeAgentPendingRequestClient = Pick<CodeAgentClient, "resolvePendingRequest">;
export type CodeAgentWorkbenchClient = CodeAgentReadClient &
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

export const codeAgentClient = new CodeAgentClient();

export function upsertProjectTaskPage(
  currentPage: AgentTaskPage | undefined,
  task: AgentTask,
): AgentTaskPage {
  // Mutation 返回的 Task 先进入列表，避免等待 Provider 最终一致的 thread/list。
  const remainingTasks = (currentPage?.data ?? []).filter(
    (currentTask) => currentTask.id !== task.id,
  );
  return { data: [task, ...remainingTasks], nextCursor: null };
}

export function replaceProjectTaskInPage(
  currentPage: AgentTaskPage | undefined,
  task: AgentTask,
): AgentTaskPage {
  if (currentPage === undefined) {
    return { data: [task], nextCursor: null };
  }
  return {
    ...currentPage,
    data: currentPage.data.map((currentTask) => (currentTask.id === task.id ? task : currentTask)),
  };
}

export function removeProjectTaskFromPage(
  currentPage: AgentTaskPage | undefined,
  taskId: string,
): AgentTaskPage {
  return {
    data: (currentPage?.data ?? []).filter((task) => task.id !== taskId),
    nextCursor: currentPage?.nextCursor ?? null,
  };
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

async function listAllProjectTasks(projectId: string, client: CodeAgentReadClient) {
  const firstPage = await client.listTasks(projectId);
  const data = [...firstPage.data];
  let nextCursor = firstPage.nextCursor;
  const visitedCursors = new Set<string>();

  // Task 树没有“加载更多”入口，因此在 Query 边界顺序读取完整游标链。
  while (nextCursor !== null) {
    if (visitedCursors.has(nextCursor)) {
      throw new Error("CodeAgent task pagination returned a repeated cursor");
    }
    visitedCursors.add(nextCursor);
    const page = await client.listTasks(projectId, { cursor: nextCursor });
    data.push(...page.data);
    nextCursor = page.nextCursor;
  }

  return { data, nextCursor: null };
}

export function projectTasksQueryOptions(
  projectId: string,
  client: CodeAgentReadClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => listAllProjectTasks(projectId, client),
    queryKey: ["projects", projectId, "tasks"] as const,
  });
}

export function taskSnapshotQueryOptions(
  projectId: string,
  taskId: string,
  client: CodeAgentSnapshotClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => client.readTask(projectId, taskId),
    queryKey: ["projects", projectId, "tasks", taskId] as const,
  });
}
