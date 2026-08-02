import type {
  AgentCapabilities,
  AgentTask,
  AgentTaskPage,
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
  useSyncExternalStore,
} from "react";

import { i18n } from "../../i18n/i18n.js";
import type { ReactNode } from "react";

import {
  createProjectRuntimeManager,
  type ProjectRuntimeManager,
} from "../conversation/runtime/project-runtime.js";
import type { TaskActivityMap } from "../conversation/runtime/task-activity.js";
import { createAsyncActionLock } from "../../shared/utils/async-action-lock.js";
import { ProjectGitStatusCoordinator } from "./project-git-status-coordinator.js";
import {
  capabilitiesQueryOptions,
  codeAgentClient,
  flattenProjectTaskPages,
  PROJECT_TASK_SEARCH_SOURCE_KEY,
  projectTasksInfiniteQueryOptions,
  projectTaskSearchSourceQueryOptions,
  projectRemoveMutationOptions,
  projectRenameMutationOptions,
  projectReorderMutationOptions,
  projectsQueryOptions,
  reorderProjectPage,
  taskSnapshotQueryOptions,
  updateNewTaskTitleFromSnapshotInInfiniteData,
  updateNewTaskTitleFromSnapshotInTasks,
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

type ProjectDataContextValue = Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  error: Error | null;
  isPending: boolean;
  projectTaskStates: ReadonlyMap<string, ProjectTaskListState>;
  projects: readonly Project[];
  tasks: readonly AgentTask[];
}>;

type ProjectActionsContextValue = Readonly<{
  addProject: () => Promise<Project | undefined>;
  fetchNextProjectTaskPage: (projectId: string) => Promise<void>;
  forgetTask: (projectId: string, taskId: string) => void;
  markTaskRunning: (projectId: string, taskId: string) => void;
  projectRuntime: ProjectRuntimeManager;
  requestNotificationPermission: () => void;
  reorderProjects: (projectIds: readonly string[]) => Promise<boolean>;
  removeProject: (projectId: string) => Promise<readonly Project[] | undefined>;
  renameProject: (projectId: string, name: string) => Promise<boolean>;
  refreshProjectGitStatus: (projectId: string) => Promise<void>;
  retry: () => Promise<void>;
  setExpandedProjectTaskIds: (projectIds: ReadonlySet<string>) => void;
  viewTask: (projectId: string, taskId?: string) => void;
}>;

type ProjectActivityContextValue = Readonly<{
  addProjectError: Error | null;
  isProjectActionPending: boolean;
  isProjectOrderPending: boolean;
  isProjectPickerOpen: boolean;
  projectActionError: Error | null;
  projectOrderError: Error | null;
  taskActivity: TaskActivityMap;
}>;

const ProjectDataContext = createContext<ProjectDataContextValue | undefined>(undefined);
const ProjectActionsContext = createContext<ProjectActionsContextValue | undefined>(undefined);
const ProjectActivityContext = createContext<ProjectActivityContextValue | undefined>(undefined);

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

export function buildProjectTaskCollections(
  queriedProjects: readonly Project[],
  projectTaskResults: ReadonlyMap<string, ProjectTaskQueryResult>,
) {
  const tasks = queriedProjects.flatMap(
    (project) => projectTaskResults.get(project.id)?.tasks ?? emptyTasks,
  );
  const projectTaskStates = new Map(
    queriedProjects.map((project) => [
      project.id,
      projectTaskResults.get(project.id)?.state ?? pendingProjectTaskState,
    ]),
  );

  return { projectTaskStates, tasks } as const;
}

export function ProjectProvider({ children, client = codeAgentClient }: ProjectProviderProps) {
  const queryClient = useQueryClient();
  const gitStatusCoordinator = useMemo(
    () => new ProjectGitStatusCoordinator(queryClient, client),
    [client, queryClient],
  );
  const projectRuntime = useMemo(() => {
    const taskMetadataSyncs = new Map<string, Promise<void>>();
    return createProjectRuntimeManager(client, {
      onProjectGitActivity(projectId, taskId, reason) {
        gitStatusCoordinator.handleActivity(projectId, taskId, reason);
      },
      onTaskMetadataChanged(projectId, taskId, reason) {
        const syncTaskMetadata = async () => {
          if (reason === "turn_completed") {
            // 终态先校准服务端列表顺序，再用 Task Snapshot 保证标题不会被旧列表覆盖。
            await Promise.all([
              queryClient.invalidateQueries({
                exact: true,
                queryKey: ["projects", projectId, "tasks"],
              }),
              queryClient.invalidateQueries({
                exact: true,
                queryKey: ["projects", projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
              }),
            ]);
          }
          await queryClient.invalidateQueries({
            exact: true,
            queryKey: ["projects", projectId, "tasks", taskId],
            refetchType: "none",
          });
          const response = await queryClient.fetchQuery(
            taskSnapshotQueryOptions(projectId, taskId, client),
          );
          queryClient.setQueryData<ProjectTaskInfiniteData>(
            ["projects", projectId, "tasks"],
            (currentData) =>
              updateNewTaskTitleFromSnapshotInInfiniteData(currentData, response.snapshot, {
                assistantReplyStarted: reason === "assistant_reply_started",
              }),
          );
          queryClient.setQueryData<readonly AgentTask[]>(
            ["projects", projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
            (currentTasks) =>
              currentTasks === undefined
                ? undefined
                : updateNewTaskTitleFromSnapshotInTasks(currentTasks, response.snapshot, {
                    assistantReplyStarted: reason === "assistant_reply_started",
                  }),
          );
        };
        const syncKey = `${projectId}\u0000${taskId}`;
        // 同一 Task 串行同步，避免 Turn 终态复用仍在进行的流式 Snapshot 请求。
        const sync = (taskMetadataSyncs.get(syncKey) ?? Promise.resolve())
          .catch(() => undefined)
          .then(syncTaskMetadata);
        taskMetadataSyncs.set(syncKey, sync);
        const clearCompletedSync = () => {
          if (taskMetadataSyncs.get(syncKey) === sync) {
            taskMetadataSyncs.delete(syncKey);
          }
        };
        void sync.then(clearCompletedSync, clearCompletedSync);
      },
    });
  }, [client, gitStatusCoordinator, queryClient]);
  const [addProjectError, setAddProjectError] = useState<Error | null>(null);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [projectOrderError, setProjectOrderError] = useState<Error | null>(null);
  const [projectActionError, setProjectActionError] = useState<Error | null>(null);
  const [projectTaskResults, setProjectTaskResults] = useState<
    ReadonlyMap<string, ProjectTaskQueryResult>
  >(() => new Map());
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [expandedProjectTaskIds, setExpandedProjectTaskIdsState] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const taskActivity = useSyncExternalStore(
    useCallback(
      (listener: () => void) => projectRuntime.subscribeTaskActivity(listener),
      [projectRuntime],
    ),
    useCallback(() => projectRuntime.getTaskActivity(), [projectRuntime]),
    useCallback(() => projectRuntime.getTaskActivity(), [projectRuntime]),
  );
  const capabilitiesQuery = useQuery(capabilitiesQueryOptions(client));
  const projectsQuery = useQuery(projectsQueryOptions(client));
  const { isPending: isProjectOrderPending, mutateAsync: mutateProjectOrder } = useMutation(
    projectReorderMutationOptions(client),
  );
  const { isPending: isProjectRenamePending, mutateAsync: mutateProjectRename } = useMutation(
    projectRenameMutationOptions(client),
  );
  const { isPending: isProjectRemovePending, mutateAsync: mutateProjectRemove } = useMutation(
    projectRemoveMutationOptions(client),
  );
  const addProjectLockRef = useRef(createAsyncActionLock());
  const projectActionLockRef = useRef(createAsyncActionLock());
  const projectOrderLockRef = useRef(createAsyncActionLock());
  const projects = projectsQuery.data?.data ?? emptyProjects;
  const queriedProjectIds = useMemo(() => {
    const projectIds = new Set(expandedProjectTaskIds);
    if (activeProjectId !== undefined) {
      projectIds.add(activeProjectId);
    }
    return projectIds;
  }, [activeProjectId, expandedProjectTaskIds]);
  const queriedProjects = useMemo(
    () => projects.filter((project) => queriedProjectIds.has(project.id)),
    [projects, queriedProjectIds],
  );
  const projectTaskResultsRef = useRef(projectTaskResults);
  projectTaskResultsRef.current = projectTaskResults;
  const updateProjectTaskResult = useCallback(
    (projectId: string, nextResult: ProjectTaskQueryResult) => {
      projectRuntime.rememberTaskTitles(nextResult.tasks);
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
    [projectRuntime],
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
  // 派生集合只在查询范围或结果变化时重建，保持 Context value 的引用稳定。
  const { projectTaskStates, tasks } = useMemo(
    () => buildProjectTaskCollections(queriedProjects, projectTaskResults),
    [projectTaskResults, queriedProjects],
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
  const markTaskRunning = useCallback(
    (projectId: string, taskId: string) => {
      projectRuntime.markTaskRunning(projectId, taskId);
    },
    [projectRuntime],
  );
  const forgetTask = useCallback(
    (projectId: string, taskId: string) => {
      projectRuntime.forgetTask(projectId, taskId);
    },
    [projectRuntime],
  );
  const viewTask = useCallback(
    (projectId: string, taskId?: string) => {
      // 当前路由始终激活对应列表，即使用户把该 Project 的任务树收起。
      setActiveProjectId((currentProjectId) =>
        currentProjectId === projectId ? currentProjectId : projectId,
      );
      projectRuntime.viewTask(projectId, taskId);
    },
    [projectRuntime],
  );
  const setExpandedProjectTaskIds = useCallback((projectIds: ReadonlySet<string>) => {
    setExpandedProjectTaskIdsState((currentProjectIds) => {
      if (
        currentProjectIds.size === projectIds.size &&
        [...currentProjectIds].every((projectId) => projectIds.has(projectId))
      ) {
        return currentProjectIds;
      }
      return new Set(projectIds);
    });
  }, []);
  const requestNotificationPermission = useCallback(() => {
    // 由 Composer 的用户手势触发；权限失败只关闭增强能力，不阻断 Task 操作。
    void projectRuntime.requestNotificationPermission();
  }, [projectRuntime]);
  const addProject = useCallback(
    () =>
      addProjectLockRef.current.run(async () => {
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
          const normalizedError =
            error instanceof Error
              ? error
              : new Error(i18n.t("errors.addProject", { ns: "conversation" }));
          setAddProjectError(normalizedError);
          // 错误已进入可见状态，避免按钮事件产生未处理的 Promise rejection。
          return undefined;
        } finally {
          setIsProjectPickerOpen(false);
        }
      }),
    [client, queryClient],
  );
  const reorderProjects = useCallback(
    async (projectIds: readonly string[]) =>
      (await projectOrderLockRef.current.run(async () => {
        const currentPage = queryClient.getQueryData<ProjectPage>(["projects"]);
        const optimisticPage = reorderProjectPage(currentPage, projectIds);
        if (optimisticPage === undefined) {
          setProjectOrderError(
            new Error(i18n.t("errors.reorderProjectChanged", { ns: "conversation" })),
          );
          return false;
        }

        setProjectOrderError(null);
        // 拖动释放后立即更新列表；服务端失败时恢复提交前的完整快照。
        queryClient.setQueryData<ProjectPage>(["projects"], optimisticPage);
        try {
          const response = await mutateProjectOrder(projectIds);
          queryClient.setQueryData<ProjectPage>(["projects"], response);
          return true;
        } catch (error) {
          queryClient.setQueryData<ProjectPage>(["projects"], currentPage);
          setProjectOrderError(
            error instanceof Error
              ? error
              : new Error(i18n.t("errors.reorderProject", { ns: "conversation" })),
          );
          return false;
        }
      })) ?? false,
    [mutateProjectOrder, queryClient],
  );
  const renameProject = useCallback(
    async (projectId: string, name: string) =>
      (await projectActionLockRef.current.run(async () => {
        setProjectActionError(null);
        try {
          const response = await mutateProjectRename({ name, projectId });
          queryClient.setQueryData<ProjectPage>(["projects"], (currentPage) =>
            currentPage === undefined
              ? undefined
              : {
                  ...currentPage,
                  data: currentPage.data.map((project) =>
                    project.id === projectId ? response.project : project,
                  ),
                },
          );
          return true;
        } catch {
          setProjectActionError(new Error(i18n.t("errors.renameProject", { ns: "conversation" })));
          return false;
        }
      })) ?? false,
    [mutateProjectRename, queryClient],
  );
  const removeProject = useCallback(
    (projectId: string) =>
      projectActionLockRef.current.run(async () => {
        setProjectActionError(null);
        try {
          await mutateProjectRemove(projectId);
          // 先停止该 Project 的请求和实时连接，再从列表移除，避免旧响应回填缓存。
          await queryClient.cancelQueries({ queryKey: ["projects", projectId] });
          queryClient.removeQueries({ queryKey: ["projects", projectId] });
          gitStatusCoordinator.forgetProject(projectId);
          projectRuntime.forgetProject(projectId);
          const currentPage = queryClient.getQueryData<ProjectPage>(["projects"]);
          const remainingProjects =
            currentPage?.data.filter((project) => project.id !== projectId) ?? emptyProjects;
          queryClient.setQueryData<ProjectPage>(
            ["projects"],
            currentPage === undefined ? undefined : { ...currentPage, data: remainingProjects },
          );
          return remainingProjects;
        } catch {
          setProjectActionError(new Error(i18n.t("errors.deleteProject", { ns: "conversation" })));
          return undefined;
        }
      }),
    [gitStatusCoordinator, mutateProjectRemove, projectRuntime, queryClient],
  );
  const refreshProjectGitStatus = useCallback(
    (projectId: string) => gitStatusCoordinator.refreshProject(projectId),
    [gitStatusCoordinator],
  );
  const retry = useCallback(async () => {
    // Runtime 恢复后统一刷新全部服务端状态，避免部分 Query 继续保留失败结果。
    await queryClient.invalidateQueries();
  }, [queryClient]);

  useEffect(
    () => () => {
      projectRuntime.dispose();
      gitStatusCoordinator.dispose();
    },
    [gitStatusCoordinator, projectRuntime],
  );

  const dataValue = useMemo<ProjectDataContextValue>(
    () => ({
      capabilities: capabilitiesQuery.data,
      client,
      error: capabilitiesQuery.error ?? projectsQuery.error,
      isPending,
      projectTaskStates,
      projects,
      tasks,
    }),
    [
      capabilitiesQuery.data,
      capabilitiesQuery.error,
      client,
      isPending,
      projectTaskStates,
      projects,
      projectsQuery.error,
      tasks,
    ],
  );
  const actionsValue = useMemo<ProjectActionsContextValue>(
    () => ({
      addProject,
      fetchNextProjectTaskPage,
      forgetTask,
      markTaskRunning,
      projectRuntime,
      refreshProjectGitStatus,
      removeProject,
      renameProject,
      reorderProjects,
      requestNotificationPermission,
      retry,
      setExpandedProjectTaskIds,
      viewTask,
    }),
    [
      addProject,
      fetchNextProjectTaskPage,
      forgetTask,
      markTaskRunning,
      projectRuntime,
      refreshProjectGitStatus,
      removeProject,
      renameProject,
      reorderProjects,
      requestNotificationPermission,
      retry,
      setExpandedProjectTaskIds,
      viewTask,
    ],
  );
  const activityValue = useMemo<ProjectActivityContextValue>(
    () => ({
      addProjectError,
      isProjectActionPending: isProjectRenamePending || isProjectRemovePending,
      isProjectOrderPending,
      isProjectPickerOpen,
      projectActionError,
      projectOrderError,
      taskActivity,
    }),
    [
      addProjectError,
      isProjectPickerOpen,
      projectActionError,
      projectOrderError,
      isProjectOrderPending,
      isProjectRemovePending,
      isProjectRenamePending,
      taskActivity,
    ],
  );

  return (
    <>
      {queriedProjects.map((project) => (
        <ProjectTaskQuery
          client={client}
          key={project.id}
          onRemove={removeProjectTaskResult}
          onUpdate={updateProjectTaskResult}
          projectId={project.id}
        />
      ))}
      <ProjectDataContext.Provider value={dataValue}>
        <ProjectActionsContext.Provider value={actionsValue}>
          <ProjectActivityContext.Provider value={activityValue}>
            {children}
          </ProjectActivityContext.Provider>
        </ProjectActionsContext.Provider>
      </ProjectDataContext.Provider>
    </>
  );
}

export function useProjectData() {
  const context = useContext(ProjectDataContext);
  if (context === undefined) {
    throw new Error("useProjectData must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectActions() {
  const context = useContext(ProjectActionsContext);
  if (context === undefined) {
    throw new Error("useProjectActions must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectActivity() {
  const context = useContext(ProjectActivityContext);
  if (context === undefined) {
    throw new Error("useProjectActivity must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectTaskSearch(normalizedQuery: string) {
  const { client, projects } = useProjectData();
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
