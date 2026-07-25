import type { AgentCapabilities, AgentTask, Project } from "@code-agent/protocol";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext } from "react";
import type { ReactNode } from "react";

import {
  capabilitiesQueryOptions,
  codeAgentClient,
  projectTasksQueryOptions,
  projectsQueryOptions,
  type CodeAgentWorkbenchClient,
} from "./project-queries.js";

const emptyProjects: readonly Project[] = [];
const emptyTasks: readonly AgentTask[] = [];

type ProjectContextValue = Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  error: Error | null;
  isPending: boolean;
  projects: readonly Project[];
  retry: () => Promise<void>;
  tasks: readonly AgentTask[];
}>;

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

type ProjectProviderProps = Readonly<{
  children: ReactNode;
  client?: CodeAgentWorkbenchClient;
}>;

export function ProjectProvider({ children, client = codeAgentClient }: ProjectProviderProps) {
  const queryClient = useQueryClient();
  const capabilitiesQuery = useQuery(capabilitiesQueryOptions(client));
  const projectsQuery = useQuery(projectsQueryOptions(client));
  const projects = projectsQuery.data?.data ?? emptyProjects;
  const taskQueries = useQueries({
    queries: projects.map((project) => projectTasksQueryOptions(project.id, client)),
  });
  const tasks = taskQueries.flatMap((query) => query.data?.data ?? emptyTasks);
  const taskError = taskQueries.find((query) => query.error !== null)?.error ?? null;
  const isPending = projectsQuery.isPending || taskQueries.some((query) => query.isPending);
  const retry = useCallback(async () => {
    // Runtime 恢复后统一刷新全部服务端状态，避免部分 Query 继续保留失败结果。
    await queryClient.invalidateQueries();
  }, [queryClient]);

  return (
    <ProjectContext.Provider
      value={{
        capabilities: capabilitiesQuery.data,
        client,
        error: capabilitiesQuery.error ?? projectsQuery.error ?? taskError,
        isPending,
        projects,
        retry,
        tasks,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProjects must be used inside ProjectProvider");
  }
  return context;
}
