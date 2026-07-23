import { CodeAgentClient } from "@code-agent/client";
import { queryOptions } from "@tanstack/react-query";

export type CodeAgentReadClient = Pick<CodeAgentClient, "listProjects" | "listTasks" | "readTask">;
export type CodeAgentRuntimeClient = Pick<CodeAgentClient, "readTask" | "subscribeEvents">;
export type CodeAgentCapabilitiesClient = Pick<CodeAgentClient, "getCapabilities">;
export type CodeAgentMutationClient = Pick<
  CodeAgentClient,
  "interruptTurn" | "startTask" | "startTurn"
>;
export type CodeAgentWorkbenchClient = CodeAgentReadClient &
  CodeAgentRuntimeClient &
  CodeAgentMutationClient &
  CodeAgentCapabilitiesClient;
type CodeAgentSnapshotClient = Pick<CodeAgentClient, "readTask">;

export const codeAgentClient = new CodeAgentClient();

export function capabilitiesQueryOptions(client: CodeAgentCapabilitiesClient = codeAgentClient) {
  return queryOptions({
    queryFn: () => client.getCapabilities(),
    queryKey: ["capabilities"] as const,
  });
}

export function projectsQueryOptions(client: CodeAgentReadClient = codeAgentClient) {
  return queryOptions({
    queryFn: () => client.listProjects(),
    queryKey: ["projects"] as const,
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
