import type {
  AgentMessageAttachment,
  AgentPromptInput,
  AgentTask,
  AgentTaskSettings,
  AgentTurn,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { useAccess } from "../../access/access-context.js";
import {
  mergeSubmittedPromptIntoSnapshot,
  type RuntimeTaskSnapshot,
} from "../../conversation/runtime/task-runtime.js";
import { useTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { useProjectActions, useProjectData } from "../../projects/project-context.js";
import {
  appInfoQueryOptions,
  appUpdateMutationOptions,
  globalSettingsMutationOptions,
  globalSettingsQueryOptions,
  mcpServersQueryOptions,
  modelsQueryOptions,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectFileTreeQueryOptions,
  projectGitStatusQueryOptions,
  projectOpenCapabilitiesQueryOptions,
  skillsQueryOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { useBackgroundTerminals } from "../hooks/use-background-terminals.js";
import type { CommitChangesLauncherHandle } from "./commit-changes-launcher.js";
import { deriveProjectSidebarConnectionState } from "./project-sidebar.js";
import { collectSubagents, type SubagentSelection } from "./subagent.js";
import type {
  ProjectFileTreeDirectoryState,
  WorkbenchInspectorTab,
} from "./workbench-inspector.js";

const sidebarOverlayQuery = "(max-width: 760px)";
const inspectorOverlayQuery = "(max-width: 1100px)";
const sidebarWidthLimits = { default: 288, maximum: 400, minimum: 220 } as const;
const inspectorWidthLimits = { default: 288, maximum: 480, minimum: 260 } as const;
const emptyExpandedFileTreePaths = new Set<string>();

export function loadProjectSourceDialog() {
  return import("./project-source-dialog.js");
}

// 非首屏工具统一保留独立动态入口，避免 UI 装配文件重新引入静态依赖。
export function loadWorkbenchInspector() {
  return import("./workbench-inspector.js");
}

export function loadFileDiffDialog() {
  return import("../../diff/file-diff-dialog.js");
}

export function loadFileReviewDialog() {
  return import("../../diff/file-review-dialog.js");
}

export function taskLaunchQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "launch"] as const;
}

export type TaskLaunchState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  settings: AgentTaskSettings;
  submissionStartedAt?: string;
  task: AgentTask;
  turn: AgentTurn;
}>;

export type SubmittedPromptState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  submissionStartedAt?: string;
  turn: AgentTurn;
}>;

export type WorkbenchShellProps = Readonly<{
  projectId: string;
  taskId?: string;
}>;

function shouldOpenDesktopPanel(query: string) {
  return typeof window === "undefined" || !window.matchMedia(query).matches;
}

export function useSubmissionStartedAt() {
  const [startedAt, setStartedAt] = useState<string>();
  const startedAtRef = useRef<string | undefined>(undefined);
  const beginSubmission = useCallback(() => {
    const nextStartedAt = new Date().toISOString();
    startedAtRef.current = nextStartedAt;
    setStartedAt(nextStartedAt);
  }, []);
  const handleSubmissionStateChange = useCallback((submitting: boolean) => {
    if (submitting) {
      if (startedAtRef.current === undefined) {
        const nextStartedAt = new Date().toISOString();
        startedAtRef.current = nextStartedAt;
        setStartedAt(nextStartedAt);
      }
      return;
    }
    startedAtRef.current = undefined;
    setStartedAt(undefined);
  }, []);
  const getStartedAt = useCallback(() => startedAtRef.current, []);
  return { beginSubmission, getStartedAt, handleSubmissionStateChange, startedAt } as const;
}

export function useWorkbenchShellRuntime({ projectId, taskId }: WorkbenchShellProps) {
  const { t } = useTranslation("workbench");
  const access = useAccess();
  const { capabilities, client, error, isPending, projects, projectTaskStates, tasks } =
    useProjectData();
  const {
    markTaskRunning,
    projectRuntime,
    refreshProjectGitStatus,
    requestNotificationPermission,
    retry,
    viewTask,
  } = useProjectActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appInfoQuery = useQuery(appInfoQueryOptions(client));
  const appUpdateMutation = useMutation({
    ...appUpdateMutationOptions(client),
    onSuccess(response) {
      queryClient.setQueryData(["app-info"], response);
    },
  });
  const modelsQuery = useQuery(modelsQueryOptions(client));
  const mcpServersQuery = useQuery(mcpServersQueryOptions(projectId, taskId, client));
  const globalSettingsQuery = useQuery(globalSettingsQueryOptions(client));
  const projectOpenCapabilitiesQuery = useQuery(
    projectOpenCapabilitiesQueryOptions(projectId, client),
  );
  const projectPathOpenMutation = useMutation({
    mutationFn: ({
      appId,
      path,
    }: Readonly<{ appId: ProjectOpenAppId; path: string | undefined }>) =>
      client.openProject(projectId, path === undefined ? { appId } : { appId, path }),
  });
  const projectPathOpenMutationRef = useRef(projectPathOpenMutation);
  projectPathOpenMutationRef.current = projectPathOpenMutation;
  const projectPathOpenLockRef = useRef(createAsyncActionLock());
  const skillsQuery = useQuery({
    ...skillsQueryOptions(projectId, client),
    enabled: capabilities?.skills.list === true,
  });
  const projectDefaultsQuery = useQuery(projectDefaultsQueryOptions(projectId, client));
  const projectDefaultsMutation = useMutation({
    ...projectDefaultsMutationOptions(projectId, client),
    onSuccess(response) {
      queryClient.setQueryData(["projects", projectId, "defaults"], response);
    },
  });
  const globalSettingsMutation = useMutation({
    ...globalSettingsMutationOptions(client),
    async onSuccess(response) {
      queryClient.setQueryData(["settings"], response);
      // 局部显式设置仍由 Server 保持优先；刷新只让未配置的当前上下文重新解析全局回退。
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: ["projects", projectId, "defaults"],
      });
      if (taskId !== undefined) {
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: ["projects", projectId, "tasks", taskId],
        });
      }
    },
  });
  const runtime = useTaskRuntime(projectId, taskId, projectRuntime);
  const taskLaunchState =
    taskId === undefined
      ? undefined
      : queryClient.getQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, taskId));
  const startingSnapshot = useMemo<RuntimeTaskSnapshot | undefined>(
    () =>
      taskLaunchState === undefined
        ? undefined
        : mergeSubmittedPromptIntoSnapshot(
            {
              ...taskLaunchState.task,
              contextUsage: null,
              pendingRequests: [],
              settings: taskLaunchState.settings,
              status: "running",
              turns: [taskLaunchState.turn],
            },
            taskLaunchState.turn,
            { ...taskLaunchState.input, messageAttachments: taskLaunchState.messageAttachments },
          ),
    [taskLaunchState],
  );
  const projectTaskState = projectTaskStates.get(projectId);
  const sidebarConnectionState = deriveProjectSidebarConnectionState({
    hasActiveTask: taskId !== undefined,
    projectDataFailed: error !== null || (projectTaskState?.error ?? null) !== null,
    projectDataPending: isPending || projectTaskState?.isPending === true,
    taskConnectionState: runtime.connectionState,
  });
  const isTaskRunning =
    runtime.snapshot?.status === "running" || startingSnapshot?.status === "running";
  const backgroundTerminals = useBackgroundTerminals(client, projectId, taskId, isTaskRunning);
  const gitStatusQuery = useQuery(projectGitStatusQueryOptions(projectId, client));
  const [fileTreeExpansion, setFileTreeExpansion] = useState(() => ({
    paths: new Set<string>(),
    projectId,
  }));
  const expandedFileTreePaths =
    fileTreeExpansion.projectId === projectId
      ? fileTreeExpansion.paths
      : emptyExpandedFileTreePaths;
  const fileTreeDirectoryPaths = useMemo<readonly (string | null)[]>(
    () => [null, ...expandedFileTreePaths],
    [expandedFileTreePaths],
  );
  const fileTreeQueries = useQueries({
    queries: fileTreeDirectoryPaths.map((directoryPath) =>
      projectFileTreeQueryOptions(projectId, directoryPath, client),
    ),
  });
  const fileTreeDirectories: readonly ProjectFileTreeDirectoryState[] = fileTreeDirectoryPaths.map(
    (path, index) => {
      const query = fileTreeQueries[index];
      return {
        ...(query?.data === undefined ? {} : { data: query.data }),
        error: query?.error ?? null,
        isFetching: query?.isFetching ?? false,
        isPending: query?.isPending ?? true,
        path,
      };
    },
  );
  // 窄屏首次进入时保持主时间线可见，面板由工具栏按需打开。
  const [sidebarOpen, setSidebarOpen] = useState(() => shouldOpenDesktopPanel(sidebarOverlayQuery));
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    shouldOpenDesktopPanel(inspectorOverlayQuery),
  );
  // 右栏页签只响应用户点击，运行态数据更新不能改变当前选择。
  const [inspectorTab, setInspectorTab] = useState<WorkbenchInspectorTab>("changes");
  const [sidebarWidth, setSidebarWidth] = useState<number>(sidebarWidthLimits.default);
  const [inspectorWidth, setInspectorWidth] = useState<number>(inspectorWidthLimits.default);
  const workbenchShellRef = useRef<HTMLDivElement>(null);
  const commitChangesLauncherRef = useRef<CommitChangesLauncherHandle>(null);
  const {
    beginSubmission: beginNewChatSubmission,
    getStartedAt: getNewChatSubmissionStartedAt,
    handleSubmissionStateChange: handleNewChatSubmissionStateChange,
    startedAt: newChatSubmissionStartedAt,
  } = useSubmissionStartedAt();
  const [pendingTaskSelection, setPendingTaskSelection] = useState<{
    projectId: string;
    taskId: string;
  }>();
  const [taskRenameOpen, setTaskRenameOpen] = useState(false);
  const [taskRenameError, setTaskRenameError] = useState<string | null>(null);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [fileDiffSelection, setFileDiffSelection] = useState<{
    change: AgentFileChange;
    projectId: string;
  } | null>(null);
  const [fileReviewSelection, setFileReviewSelection] = useState<{
    changes: readonly AgentFileChange[];
    projectId: string;
  } | null>(null);
  const [sourceFileSelection, setSourceFileSelection] = useState<{
    kind: "image" | "source";
    projectId: string;
    reference: MessageFileReference;
  } | null>(null);
  const [subagentDialogSelection, setSubagentDialogSelection] = useState<{
    parentTaskId: string;
    projectId: string;
    selection: SubagentSelection;
  } | null>(null);

  useLayoutEffect(() => {
    // 路由提交后、页面绘制前消费提醒，避免实时终态与被动 Effect 形成竞态。
    viewTask(projectId, taskId);
  }, [projectId, taskId, viewTask]);
  const project = projects.find((item) => item.id === projectId);
  const projectName = project?.name ?? projectId;
  const projectPath = project?.rootPath ?? projectId;
  const title =
    tasks.find((task) => task.projectId === projectId && task.id === taskId)?.title ??
    runtime.snapshot?.title ??
    t("shell.newChat");
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const activeTaskRenameLockRef = useRef(createAsyncActionLock());
  const selectedFileChange =
    fileDiffSelection !== null && fileDiffSelection.projectId === projectId
      ? fileDiffSelection.change
      : null;
  const selectedSourceFile =
    sourceFileSelection !== null && sourceFileSelection.projectId === projectId
      ? sourceFileSelection
      : null;
  const selectedFileReview =
    fileReviewSelection !== null && fileReviewSelection.projectId === projectId
      ? fileReviewSelection.changes
      : null;
  const subagents = useMemo(
    () => collectSubagents(runtime.snapshot ?? startingSnapshot),
    [runtime.snapshot, startingSnapshot],
  );
  const selectedSubagent =
    subagentDialogSelection !== null &&
    subagentDialogSelection.projectId === projectId &&
    subagentDialogSelection.parentTaskId === taskId
      ? {
          ...subagentDialogSelection.selection,
          status:
            subagents.find(
              (subagent) => subagent.taskId === subagentDialogSelection.selection.taskId,
            )?.status ?? subagentDialogSelection.selection.status,
        }
      : null;
  return {
    access,
    activeTaskRenameLockRef,
    appInfoQuery,
    appUpdateMutation,
    backgroundTerminals,
    beginNewChatSubmission,
    capabilities,
    client,
    commitChangesLauncherRef,
    error,
    expandedFileTreePaths,
    fileDiffSelection,
    fileReviewSelection,
    fileTreeDirectories,
    fileTreeDirectoryPaths,
    fileTreeQueries,
    getNewChatSubmissionStartedAt,
    gitStatusQuery,
    globalSettingsMutation,
    globalSettingsOpen,
    globalSettingsQuery,
    handleNewChatSubmissionStateChange,
    inspectorOpen,
    inspectorTab,
    inspectorTask: runtime.snapshot ?? startingSnapshot,
    inspectorWidth,
    isPending,
    markTaskRunning,
    mcpServersQuery,
    modelsQuery,
    navigate,
    newChatSubmissionStartedAt,
    pendingTaskSelection,
    projectDefaultsMutation,
    projectDefaultsQuery,
    projectName,
    projectOpenCapabilitiesQuery,
    projectPath,
    projectPathOpenLockRef,
    projectPathOpenMutation,
    projectPathOpenMutationRef,
    projectRuntime,
    projectTaskState,
    projects,
    queryClient,
    refreshProjectGitStatus,
    renameMutation,
    requestNotificationPermission,
    retry,
    runtime,
    selectedFileChange,
    selectedFileReview,
    selectedSourceFile,
    selectedSubagent,
    setFileDiffSelection,
    setFileReviewSelection,
    setFileTreeExpansion,
    setGlobalSettingsOpen,
    setInspectorOpen,
    setInspectorTab,
    setInspectorWidth,
    setPendingTaskSelection,
    setSidebarOpen,
    setSidebarWidth,
    setSourceFileSelection,
    setSubagentDialogSelection,
    setTaskRenameError,
    setTaskRenameOpen,
    sidebarConnectionState,
    sidebarOpen,
    sidebarWidth,
    skillsQuery,
    startingSnapshot,
    subagents,
    taskLaunchState,
    taskRenameError,
    taskRenameOpen,
    tasks,
    t,
    title,
    viewTask,
    workbenchShellRef,
  };
}
