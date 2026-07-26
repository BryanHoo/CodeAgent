import type { AgentCapabilities, AgentTask, Project } from "@code-agent/protocol";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState } from "react";
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
  addProject: () => Promise<Project | undefined>;
  addProjectError: Error | null;
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  error: Error | null;
  isPending: boolean;
  isProjectPickerOpen: boolean;
  projectTaskStates: ReadonlyMap<string, Readonly<{ error: Error | null; isPending: boolean }>>;
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
  const [addProjectError, setAddProjectError] = useState<Error | null>(null);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const capabilitiesQuery = useQuery(capabilitiesQueryOptions(client));
  const projectsQuery = useQuery(projectsQueryOptions(client));
  const projects = projectsQuery.data?.data ?? emptyProjects;
  const taskQueries = useQueries({
    queries: projects.map((project) => projectTasksQueryOptions(project.id, client)),
  });
  const tasks = taskQueries.flatMap((query) => query.data?.data ?? emptyTasks);
  // Project Task 查询状态按 Project 隔离，单个目录失败不能阻断其他工作台。
  const projectTaskStates = new Map(
    projects.map((project, index) => {
      const query = taskQueries[index];
      return [
        project.id,
        { error: query?.error ?? null, isPending: query?.isPending ?? true },
      ] as const;
    }),
  );
  const isPending = projectsQuery.isPending;
  const addProject = useCallback(async () => {
    if (isProjectPickerOpen) {
      return undefined;
    }
    setIsProjectPickerOpen(true);
    setAddProjectError(null);
    try {
      const response = await client.addProject();
      if (response.project !== null) {
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        return response.project;
      }
      return undefined;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("添加项目失败");
      setAddProjectError(normalizedError);
      // 错误已进入可见状态，避免按钮事件产生未处理的 Promise rejection。
      return undefined;
    } finally {
      setIsProjectPickerOpen(false);
    }
  }, [client, isProjectPickerOpen, queryClient]);
  const retry = useCallback(async () => {
    // Runtime 恢复后统一刷新全部服务端状态，避免部分 Query 继续保留失败结果。
    await queryClient.invalidateQueries();
  }, [queryClient]);

  return (
    <ProjectContext.Provider
      value={{
        addProject,
        addProjectError,
        capabilities: capabilitiesQuery.data,
        client,
        error: capabilitiesQuery.error ?? projectsQuery.error,
        isPending,
        isProjectPickerOpen,
        projectTaskStates,
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
