import type { AgentCapabilities, AgentTask, Project } from "@code-agent/protocol";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
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
  tasks: readonly AgentTask[];
}>;

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

type ProjectProviderProps = Readonly<{
  children: ReactNode;
  client?: CodeAgentWorkbenchClient;
}>;

export function ProjectProvider({ children, client = codeAgentClient }: ProjectProviderProps) {
  const capabilitiesQuery = useQuery(capabilitiesQueryOptions(client));
  const projectsQuery = useQuery(projectsQueryOptions(client));
  const projects = projectsQuery.data?.data ?? emptyProjects;
  const taskQueries = useQueries({
    queries: projects.map((project) => projectTasksQueryOptions(project.id, client)),
  });
  const tasks = taskQueries.flatMap((query) => query.data?.data ?? emptyTasks);
  const taskError = taskQueries.find((query) => query.error !== null)?.error ?? null;
  const isPending = projectsQuery.isPending || taskQueries.some((query) => query.isPending);

  return (
    <ProjectContext.Provider
      value={{
        capabilities: capabilitiesQuery.data,
        client,
        error: projectsQuery.error ?? taskError,
        isPending,
        projects,
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
