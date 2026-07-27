import type {
  AgentCapabilities,
  AgentTask,
  AgentTaskSnapshotResponse,
  Project,
} from "@code-agent/protocol";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  recordRunningTaskActivity,
  recordTaskActivitySnapshot,
  reduceTaskActivityEvent,
  type TaskActivityMap,
} from "../conversation/runtime/task-activity.js";
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
  markTaskRunning: (projectId: string, taskId: string) => void;
  observeTaskSnapshot: (response: AgentTaskSnapshotResponse) => void;
  projectTaskStates: ReadonlyMap<string, Readonly<{ error: Error | null; isPending: boolean }>>;
  projects: readonly Project[];
  retry: () => Promise<void>;
  taskActivity: TaskActivityMap;
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
  const [taskActivity, setTaskActivity] = useState<TaskActivityMap>(() => new Map());
  const activitySubscriptionsRef = useRef(
    new Map<string, Readonly<{ sessionId: string; unsubscribe: () => void }>>(),
  );
  const latestSnapshotTaskByProjectRef = useRef(new Map<string, string>());
  const recoveringProjectsRef = useRef(new Set<string>());
  const observeTaskSnapshotRef = useRef<((response: AgentTaskSnapshotResponse) => void) | null>(
    null,
  );
  const recoverTaskActivitySubscriptionRef = useRef<((projectId: string) => Promise<void>) | null>(
    null,
  );
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
  const startTaskActivitySubscription = useCallback(
    (response: AgentTaskSnapshotResponse) => {
      const projectId = response.snapshot.projectId;
      const currentSubscription = activitySubscriptionsRef.current.get(projectId);
      if (currentSubscription?.sessionId === response.checkpoint.sessionId) {
        return;
      }
      currentSubscription?.unsubscribe();

      // Sidebar 订阅按 Project 常驻，路由切换只替换详细 Timeline，不丢失后台 Task 终态。
      const unsubscribe = client.subscribeEvents({
        afterSequence: response.checkpoint.sequence,
        projectId,
        onEvent(event) {
          setTaskActivity((current) => reduceTaskActivityEvent(current, projectId, event));
        },
        onResyncRequired() {
          void recoverTaskActivitySubscriptionRef.current?.(projectId);
        },
        sessionId: response.checkpoint.sessionId,
      });
      activitySubscriptionsRef.current.set(projectId, {
        sessionId: response.checkpoint.sessionId,
        unsubscribe,
      });
    },
    [client],
  );
  const observeTaskSnapshot = useCallback(
    (response: AgentTaskSnapshotResponse) => {
      const snapshot = response.snapshot;
      setTaskActivity((current) => recordTaskActivitySnapshot(current, snapshot));
      latestSnapshotTaskByProjectRef.current.set(snapshot.projectId, snapshot.id);
      startTaskActivitySubscription(response);
    },
    [startTaskActivitySubscription],
  );
  const recoverTaskActivitySubscription = useCallback(
    async (projectId: string) => {
      if (recoveringProjectsRef.current.has(projectId)) {
        return;
      }
      const taskId = latestSnapshotTaskByProjectRef.current.get(projectId);
      if (taskId === undefined) {
        return;
      }
      recoveringProjectsRef.current.add(projectId);
      const currentSubscription = activitySubscriptionsRef.current.get(projectId);
      currentSubscription?.unsubscribe();
      activitySubscriptionsRef.current.delete(projectId);
      try {
        // Resync 后重新读取 Snapshot checkpoint，再建立连续的 Project Event 链路。
        const response = await client.readTask(projectId, taskId);
        observeTaskSnapshotRef.current?.(response);
      } catch {
        // 详细 Runtime 的重试仍会回填新 Snapshot；这里保留最后已知状态，避免制造错误终态。
      } finally {
        recoveringProjectsRef.current.delete(projectId);
      }
    },
    [client],
  );
  observeTaskSnapshotRef.current = observeTaskSnapshot;
  recoverTaskActivitySubscriptionRef.current = recoverTaskActivitySubscription;
  const markTaskRunning = useCallback((projectId: string, taskId: string) => {
    setTaskActivity((current) => recordRunningTaskActivity(current, projectId, taskId));
  }, []);
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

  useEffect(
    () => () => {
      // Provider 生命周期结束时统一释放所有已访问 Project 的轻量事件订阅。
      for (const subscription of activitySubscriptionsRef.current.values()) {
        subscription.unsubscribe();
      }
      activitySubscriptionsRef.current.clear();
    },
    [client],
  );

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
        markTaskRunning,
        observeTaskSnapshot,
        projectTaskStates,
        projects,
        retry,
        taskActivity,
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
