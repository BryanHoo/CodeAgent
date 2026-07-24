import { CodeAgentClient } from "@code-agent/client";
import { queryOptions } from "@tanstack/react-query";

export type CodeAgentReadClient = Pick<CodeAgentClient, "listProjects" | "listTasks" | "readTask">;
export type CodeAgentGitStatusClient = Pick<CodeAgentClient, "getProjectGitStatus">;
export type CodeAgentRuntimeClient = Pick<CodeAgentClient, "readTask" | "subscribeEvents">;
export type CodeAgentCapabilitiesClient = Pick<CodeAgentClient, "getCapabilities">;
export type CodeAgentModelsClient = Pick<CodeAgentClient, "listModels">;
export type CodeAgentMutationClient = Pick<
  CodeAgentClient,
  "interruptTurn" | "startTask" | "startTurn" | "uploadAttachment"
>;
export type CodeAgentPendingRequestClient = Pick<CodeAgentClient, "resolvePendingRequest">;
export type CodeAgentWorkbenchClient = CodeAgentReadClient &
  CodeAgentGitStatusClient &
  CodeAgentRuntimeClient &
  CodeAgentMutationClient &
  CodeAgentPendingRequestClient &
  CodeAgentCapabilitiesClient &
  CodeAgentModelsClient;
type CodeAgentSnapshotClient = Pick<CodeAgentClient, "readTask">;

export const PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 1_500;

export const codeAgentClient = new CodeAgentClient();

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
  taskId: string,
  client: CodeAgentSnapshotClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => client.readTask(taskId),
    queryKey: ["tasks", taskId] as const,
  });
}
