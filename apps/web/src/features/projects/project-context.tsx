import type {
  AgentCapabilities,
  AgentTask,
  AgentTaskPage,
  AgentTaskSnapshotResponse,
  Project,
  ProjectPage,
} from "@code-agent/protocol";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  recordRunningTaskActivity,
  recordTaskActivitySnapshot,
  reduceTaskActivityEvent,
  removeTaskActivity,
  type TaskActivityMap,
} from "../conversation/runtime/task-activity.js";
import { isTaskRuntimeActive } from "../conversation/runtime/use-task-runtime.js";
import {
  capabilitiesQueryOptions,
  codeAgentClient,
  flattenProjectTaskPages,
  projectTasksInfiniteQueryOptions,
  projectTaskSearchSourceQueryOptions,
  projectReorderMutationOptions,
  projectsQueryOptions,
  reorderProjectPage,
  type CodeAgentWorkbenchClient,
  type ProjectTaskInfiniteData,
} from "./project-queries.js";

const emptyProjects: readonly Project[] = [];
const emptyTasks: readonly AgentTask[] = [];

export type ProjectTaskListState = Readonly<{
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
}>;

type ProjectTaskPageController = Readonly<{
  fetchNextPage: () => Promise<unknown>;
}>;

type ProjectTaskQueryResult = Readonly<{
  controller: ProjectTaskPageController;
  state: ProjectTaskListState;
  tasks: readonly AgentTask[];
}>;

const pendingProjectTaskState: ProjectTaskListState = {
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  isPending: true,
};

export async function requestNextProjectTaskPage(
  projectTaskControllers: ReadonlyMap<string, ProjectTaskPageController>,
  projectId: string,
): Promise<void> {
  await projectTaskControllers.get(projectId)?.fetchNextPage();
}

type ProjectContextValue = Readonly<{
  addProject: () => Promise<Project | undefined>;
  addProjectError: Error | null;
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  error: Error | null;
  isPending: boolean;
  isProjectPickerOpen: boolean;
  isProjectOrderPending: boolean;
  fetchNextProjectTaskPage: (projectId: string) => Promise<void>;
  forgetTask: (projectId: string, taskId: string) => void;
  markTaskRunning: (projectId: string, taskId: string) => void;
  observeTaskSnapshot: (response: AgentTaskSnapshotResponse) => void;
  projectTaskStates: ReadonlyMap<string, ProjectTaskListState>;
  projects: readonly Project[];
  projectOrderError: Error | null;
  reorderProjects: (projectIds: readonly string[]) => Promise<boolean>;
  retry: () => Promise<void>;
  taskActivity: TaskActivityMap;
  tasks: readonly AgentTask[];
}>;

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

type ProjectProviderProps = Readonly<{
  children: ReactNode;
  client?: CodeAgentWorkbenchClient;
}>;

type ProjectTaskQueryProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  onRemove: (projectId: string) => void;
  onUpdate: (projectId: string, result: ProjectTaskQueryResult) => void;
  projectId: string;
}>;

function ProjectTaskQuery({ client, onRemove, onUpdate, projectId }: ProjectTaskQueryProps) {
  const query = useInfiniteQuery<
    AgentTaskPage,
    Error,
    ProjectTaskInfiniteData,
    readonly ["projects", string, "tasks"],
    string | undefined
  >(projectTasksInfiniteQueryOptions(projectId, client));
  const tasks = useMemo(() => flattenProjectTaskPages(query.data), [query.data]);

  useEffect(() => {
    onUpdate(projectId, {
      controller: { fetchNextPage: query.fetchNextPage },
      state: {
        error: query.error,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        isPending: query.isPending,
      },
      tasks,
    });
  }, [
    onUpdate,
    projectId,
    query.error,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.isPending,
    tasks,
  ]);

  useEffect(
    () => () => {
      onRemove(projectId);
    },
    [onRemove, projectId],
  );

  return null;
}

export function ProjectProvider({ children, client = codeAgentClient }: ProjectProviderProps) {
  const queryClient = useQueryClient();
  const [addProjectError, setAddProjectError] = useState<Error | null>(null);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [projectOrderError, setProjectOrderError] = useState<Error | null>(null);
  const [projectTaskResults, setProjectTaskResults] = useState<
    ReadonlyMap<string, ProjectTaskQueryResult>
  >(() => new Map());
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
  const projectOrderMutation = useMutation(projectReorderMutationOptions(client));
  const projects = projectsQuery.data?.data ?? emptyProjects;
  const projectTaskResultsRef = useRef(projectTaskResults);
  projectTaskResultsRef.current = projectTaskResults;
  const updateProjectTaskResult = useCallback(
    (projectId: string, nextResult: ProjectTaskQueryResult) => {
      setProjectTaskResults((currentResults) => {
        const currentResult = currentResults.get(projectId);
        if (
          currentResult?.tasks === nextResult.tasks &&
          currentResult.state.error === nextResult.state.error &&
          currentResult.state.hasNextPage === nextResult.state.hasNextPage &&
          currentResult.state.isFetchingNextPage === nextResult.state.isFetchingNextPage &&
          currentResult.state.isPending === nextResult.state.isPending
        ) {
          return currentResults;
        }
        const nextResults = new Map(currentResults);
        nextResults.set(projectId, nextResult);
        return nextResults;
      });
    },
    [],
  );
  const removeProjectTaskResult = useCallback((projectId: string) => {
    setProjectTaskResults((currentResults) => {
      if (!currentResults.has(projectId)) {
        return currentResults;
      }
      const nextResults = new Map(currentResults);
      nextResults.delete(projectId);
      return nextResults;
    });
  }, []);
  const tasks = projects.flatMap(
    (project) => projectTaskResults.get(project.id)?.tasks ?? emptyTasks,
  );
  // Project Task 查询状态按 Project 隔离，单个目录失败不能阻断其他工作台。
  const projectTaskStates = new Map(
    projects.map((project) => [
      project.id,
      projectTaskResults.get(project.id)?.state ?? pendingProjectTaskState,
    ]),
  );
  const fetchNextProjectTaskPage = useCallback(async (projectId: string) => {
    const controllers = new Map(
      [...projectTaskResultsRef.current].map(([currentProjectId, result]) => [
        currentProjectId,
        result.controller,
      ]),
    );
    await requestNextProjectTaskPage(controllers, projectId);
  }, []);
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
          if (event.type === "turn.completed" && !isTaskRuntimeActive(projectId, event.taskId)) {
            // 切走后完成的 Task 再尝试释放；Provider 会阻止仍有终端或请求的 Thread。
            void client.unsubscribeTask(projectId, event.taskId).catch(() => undefined);
          }
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
  const forgetTask = useCallback((projectId: string, taskId: string) => {
    setTaskActivity((current) => removeTaskActivity(current, projectId, taskId));
    if (latestSnapshotTaskByProjectRef.current.get(projectId) === taskId) {
      latestSnapshotTaskByProjectRef.current.delete(projectId);
    }
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
  const reorderProjects = useCallback(
    async (projectIds: readonly string[]) => {
      const currentPage = queryClient.getQueryData<ProjectPage>(["projects"]);
      const optimisticPage = reorderProjectPage(currentPage, projectIds);
      if (optimisticPage === undefined) {
        setProjectOrderError(new Error("项目列表已变化，请重试排序"));
        return false;
      }

      setProjectOrderError(null);
      // 拖动释放后立即更新列表；服务端失败时恢复提交前的完整快照。
      queryClient.setQueryData<ProjectPage>(["projects"], optimisticPage);
      try {
        const response = await projectOrderMutation.mutateAsync(projectIds);
        queryClient.setQueryData<ProjectPage>(["projects"], response);
        return true;
      } catch (error) {
        queryClient.setQueryData<ProjectPage>(["projects"], currentPage);
        setProjectOrderError(error instanceof Error ? error : new Error("保存项目排序失败"));
        return false;
      }
    },
    [projectOrderMutation, queryClient],
  );
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
    <>
      {projects.map((project) => (
        <ProjectTaskQuery
          client={client}
          key={project.id}
          onRemove={removeProjectTaskResult}
          onUpdate={updateProjectTaskResult}
          projectId={project.id}
        />
      ))}
      <ProjectContext.Provider
        value={{
          addProject,
          addProjectError,
          capabilities: capabilitiesQuery.data,
          client,
          error: capabilitiesQuery.error ?? projectsQuery.error,
          fetchNextProjectTaskPage,
          forgetTask,
          isPending,
          isProjectPickerOpen,
          isProjectOrderPending: projectOrderMutation.isPending,
          markTaskRunning,
          observeTaskSnapshot,
          projectTaskStates,
          projects,
          projectOrderError,
          reorderProjects,
          retry,
          taskActivity,
          tasks,
        }}
      >
        {children}
      </ProjectContext.Provider>
    </>
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProjects must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectTaskSearch(normalizedQuery: string) {
  const { client, projects } = useProjects();
  const isSearchEnabled = normalizedQuery.length > 0;
  const searchQueries = useQueries({
    queries: projects.map((project) =>
      projectTaskSearchSourceQueryOptions(project.id, isSearchEnabled, client),
    ),
  });
  const isPending = isSearchEnabled && searchQueries.some((query) => query.isPending);
  const error = searchQueries.find((query) => query.error !== null)?.error ?? null;

  // 所有 Project 的搜索源完成后再发布结果，避免把“尚未加载”误报为“没有匹配”。
  const tasks =
    isPending || error !== null
      ? emptyTasks
      : searchQueries
          .flatMap((query) => query.data ?? emptyTasks)
          .filter((task) => task.title.toLocaleLowerCase().includes(normalizedQuery));

  return { error, isPending, tasks } as const;
}
