import type { AgentTask, Project } from "@code-agent/protocol";

export type RegisterProjectInput = Readonly<{
  name: string;
  rootPath: string;
}>;

export interface ProjectRepository {
  list(): Promise<readonly Project[]>;
  register(input: RegisterProjectInput): Promise<Project>;
}

export interface TaskRepository {
  listByProject(projectId: string): Promise<readonly AgentTask[]>;
  read(taskId: string): Promise<AgentTask | undefined>;
}
