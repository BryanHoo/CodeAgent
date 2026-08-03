import type {
  AgentGlobalSettings,
  AgentProjectDefaults,
  AgentTask,
  AgentTaskSettings,
  Project,
} from "@code-agent/protocol";

export type RegisterProjectInput = Readonly<{
  name: string;
  rootPath: string;
}>;

export interface ProjectRepository {
  list(): Promise<readonly Project[]>;
  read(projectId: string): Promise<Project | undefined>;
  register(input: RegisterProjectInput): Promise<Project>;
  remove(projectId: string): Promise<boolean>;
  rename(projectId: string, name: string): Promise<Project | undefined>;
  reorder(projectIds: readonly string[]): Promise<readonly Project[]>;
}

// 设置端口只接收完整对象，具体事务与数据库实现留在 Server Adapter。
export interface AgentSettingsRepository {
  readGlobalSettings(): Promise<AgentGlobalSettings | undefined>;
  readProjectDefaults(projectId: string): Promise<AgentProjectDefaults | undefined>;
  readTaskSettings(projectId: string, taskId: string): Promise<AgentTaskSettings | undefined>;
  writeProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
  ): Promise<AgentProjectDefaults>;
  writeGlobalSettings(settings: AgentGlobalSettings): Promise<AgentGlobalSettings>;
  writeTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
  ): Promise<AgentTaskSettings>;
}

export interface TaskRepository {
  listByProject(projectId: string): Promise<readonly AgentTask[]>;
  read(taskId: string): Promise<AgentTask | undefined>;
}
