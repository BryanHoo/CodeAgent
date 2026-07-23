import { CodeAgentClient } from "@code-agent/client";
import { queryOptions } from "@tanstack/react-query";

export type CodeAgentReadClient = Pick<CodeAgentClient, "listProjects" | "listTasks" | "readTask">;

export const codeAgentClient = new CodeAgentClient();

export function projectsQueryOptions(client: CodeAgentReadClient = codeAgentClient) {
  return queryOptions({
    queryFn: () => client.listProjects(),
    queryKey: ["projects"] as const,
  });
}

export function projectTasksQueryOptions(
  projectId: string,
  client: CodeAgentReadClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => client.listTasks(projectId),
    queryKey: ["projects", projectId, "tasks"] as const,
  });
}

export function taskSnapshotQueryOptions(
  taskId: string,
  client: CodeAgentReadClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: () => client.readTask(taskId),
    queryKey: ["tasks", taskId] as const,
  });
}
