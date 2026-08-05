import type {
  AgentCapabilities,
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
  AgentTaskSnapshotResponse,
  AgentTurn,
  PendingRequest,
  ProjectGitStatus,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import { classifyProjectFileReference } from "../project-file-reference.js";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { PanelLeft, PanelRight, Pencil } from "lucide-react";

import { useProjectActions, useProjectData } from "../../projects/project-context.js";
import { useAccess } from "../../access/access-context.js";
import {
  useTaskRuntime,
  type TaskRuntimeView,
} from "../../conversation/runtime/use-task-runtime.js";
import {
  mergeSubmittedPromptIntoSnapshot,
  type RuntimeTaskSnapshot,
} from "../../conversation/runtime/task-runtime.js";
import { FileDiffDialog } from "../../diff/file-diff-dialog.js";
import { FileReviewDialog } from "../../diff/file-review-dialog.js";
import { GlobalSettingsDialog } from "../../settings/components/global-settings-dialog.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  modelsQueryOptions,
  globalSettingsMutationOptions,
  globalSettingsQueryOptions,
  mcpServersQueryOptions,
  PROJECT_TASK_SEARCH_SOURCE_KEY,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectGitStatusQueryOptions,
  projectFileTreeQueryOptions,
  projectOpenCapabilitiesQueryOptions,
  replaceProjectTaskInQueryCaches,
  skillsQueryOptions,
  taskRenameMutationOptions,
  taskSettingsMutationOptions,
  updateNewTaskTitleFromSnapshotInInfiniteData,
  upsertProjectTaskInInfiniteData,
  type ProjectTaskInfiniteData,
} from "../../projects/project-queries.js";
import { Button } from "../../../shared/ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
import { RuntimeUnavailable } from "../../../shared/ui/runtime-unavailable.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { deriveProjectSidebarConnectionState, ProjectSidebar } from "./project-sidebar.js";
import { collectSubagents, type SubagentSelection } from "./subagent.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import { TaskTimeline } from "./task-timeline.js";
import type { PendingRequestResolution } from "./pending-request.js";
import { WorkbenchComposer } from "./workbench-composer.js";
import { WorkbenchInspector, type ProjectFileTreeDirectoryState } from "./workbench-inspector.js";
import {
  CommitChangesLauncher,
  type CommitChangesLauncherHandle,
} from "./commit-changes-launcher.js";
import { WorkbenchPanelResizer } from "./workbench-panel-resizer.js";
import { useBackgroundTerminals } from "../hooks/use-background-terminals.js";

const sidebarOverlayQuery = "(max-width: 760px)";
const inspectorOverlayQuery = "(max-width: 1100px)";
const sidebarWidthLimits = { default: 288, maximum: 400, minimum: 220 } as const;
const inspectorWidthLimits = { default: 288, maximum: 480, minimum: 260 } as const;
const emptyExpandedFileTreePaths = new Set<string>();

type WorkbenchShellStyle = CSSProperties &
  Readonly<{
    "--inspector-open-width": string;
    "--sidebar-open-width": string;
  }>;

export function loadProjectSourceDialog() {
  return import("./project-source-dialog.js");
}

const LazyProjectSourceDialog = lazy(() =>
  loadProjectSourceDialog().then((module) => ({ default: module.ProjectSourceDialog })),
);

function taskLaunchQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "launch"] as const;
}

type TaskLaunchState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  settings: AgentTaskSettings;
  submissionStartedAt?: string;
  task: AgentTask;
  turn: AgentTurn;
}>;

type SubmittedPromptState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  submissionStartedAt?: string;
  turn: AgentTurn;
}>;

type WorkbenchShellProps = Readonly<{
  projectId: string;
  taskId?: string;
}>;

function shouldOpenDesktopPanel(query: string) {
  return typeof window === "undefined" || !window.matchMedia(query).matches;
}

function useSubmissionStartedAt() {
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

export function WorkbenchShell({ projectId, taskId }: WorkbenchShellProps) {
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
  const modelsQuery = useQuery(modelsQueryOptions(client));
  const mcpServersQuery = useQuery(mcpServersQueryOptions(projectId, client));
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
  const openFileDiff = useCallback(
    (change: AgentFileChange) => {
      setFileDiffSelection({ change, projectId });
    },
    [projectId],
  );
  const openMessageFileReference = useCallback(
    (reference: MessageFileReference) => {
      const kind = classifyProjectFileReference(reference.path);
      if (kind === "system") {
        const mutation = projectPathOpenMutationRef.current;
        mutation.reset();
        void projectPathOpenLockRef.current.run(() =>
          mutation.mutateAsync({
            appId: "system-default",
            path: reference.path,
          }),
        );
        return;
      }

      void loadProjectSourceDialog();
      setSourceFileSelection({ kind, projectId, reference });
    },
    [projectId],
  );
  const openFileReview = useCallback(
    (changes: readonly AgentFileChange[]) => {
      setFileReviewSelection({ changes, projectId });
    },
    [projectId],
  );
  const closeTaskRenameDialog = () => {
    setTaskRenameOpen(false);
    setTaskRenameError(null);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-task-title-rename")?.focus();
    });
  };
  const renameActiveTask = (nextTitle: string) =>
    activeTaskRenameLockRef.current.run(async () => {
      if (taskId === undefined) {
        return;
      }
      setTaskRenameError(null);
      try {
        const response = await renameMutation.mutateAsync({ projectId, taskId, title: nextTitle });
        // 服务端结果同时覆盖普通列表与已加载的搜索源，确保中栏和侧栏立即一致。
        replaceProjectTaskInQueryCaches(queryClient, response.task);
        closeTaskRenameDialog();
      } catch {
        setTaskRenameError(t("sidebar.errorRenameTask"));
      }
    });
  const cacheProjectTask = useCallback(
    (startedTask: AgentTask) => {
      queryClient.setQueryData<ProjectTaskInfiniteData>(
        ["projects", startedTask.projectId, "tasks"],
        (currentData) => upsertProjectTaskInInfiniteData(currentData, startedTask),
      );
      queryClient.setQueryData<readonly AgentTask[]>(
        ["projects", startedTask.projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
        (currentTasks) =>
          currentTasks === undefined
            ? undefined
            : [startedTask, ...currentTasks.filter((task) => task.id !== startedTask.id)],
      );
    },
    [queryClient],
  );
  const handleTaskCreated = useCallback(
    (startedTask: AgentTask) => {
      // 真实 taskId 返回后立即展示并选中，但保持 Project Composer 以支持失败重试。
      cacheProjectTask(startedTask);
      setPendingTaskSelection({ projectId: startedTask.projectId, taskId: startedTask.id });
    },
    [cacheProjectTask],
  );
  const handleTaskStarted = useCallback(
    (
      startedTask: AgentTask,
      startedTurn?: AgentTurn,
      startedInput?: AgentPromptInput,
      settings?: AgentTaskSettings,
      messageAttachments: readonly AgentMessageAttachment[] = [],
    ) => {
      cacheProjectTask(startedTask);
      if (startedTurn !== undefined && startedInput !== undefined && settings !== undefined) {
        const confirmedStartedAt = getNewChatSubmissionStartedAt() ?? startedTurn.startedAt;
        // 跨路由保存首轮启动结果，让 Snapshot 返回前即可渲染用户消息和 AI 运行态。
        queryClient.setQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, startedTask.id), {
          input: startedInput,
          messageAttachments,
          settings,
          ...(confirmedStartedAt === null ? {} : { submissionStartedAt: confirmedStartedAt }),
          task: startedTask,
          turn: startedTurn,
        });
      }
      if (startedTurn !== undefined) {
        // 首轮 Turn 已确认运行，导航前写入 Sidebar 活动态，Review 不需要伪造用户消息。
        markTaskRunning(projectId, startedTask.id);
      }
      setPendingTaskSelection(undefined);
      void navigate({
        params: { projectId, taskId: startedTask.id },
        to: "/p/$projectId/t/$taskId",
      });
    },
    [
      cacheProjectTask,
      getNewChatSubmissionStartedAt,
      markTaskRunning,
      navigate,
      projectId,
      queryClient,
    ],
  );
  const models = modelsQuery.data?.data ?? [];
  const defaultModel =
    models.find((model) => model.id === projectDefaultsQuery.data?.settings.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const globalSettings = globalSettingsQuery.data?.settings;
  // 新聊天尚无 Task 设置：审批继承 Global，其余字段使用 Project effective defaults。
  const draftSettings = useMemo<AgentTaskSettings>(
    () => ({
      ...(globalSettings?.approvalsReviewer === "auto_review"
        ? { approvalPolicy: "on-request" as const, approvalsReviewer: "auto_review" as const }
        : {
            approvalPolicy: globalSettings?.approvalPolicy ?? "on-request",
            approvalsReviewer: "user" as const,
          }),
      model: defaultModel?.id ?? projectDefaultsQuery.data?.settings.model ?? "",
      reasoningEffort:
        projectDefaultsQuery.data?.settings.reasoningEffort ??
        defaultModel?.defaultReasoningEffort ??
        "",
      sandboxMode: projectDefaultsQuery.data?.settings.sandboxMode ?? "workspace-write",
    }),
    [defaultModel, globalSettings, projectDefaultsQuery.data?.settings],
  );
  const inspectorTask = runtime.snapshot ?? startingSnapshot;
  const updateDraftSettings = async (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
  ) => {
    if (field === "approvalPolicy") {
      return;
    }
    await projectDefaultsMutation.mutateAsync({
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      sandboxMode: settings.sandboxMode,
    });
  };
  const handleNewTaskProjectChange = useCallback(
    (nextProjectId: string) => {
      // 空聊天切换只移动草稿路由，首次提交时再在目标 Project 中创建真实 Task。
      void navigate({ params: { projectId: nextProjectId }, to: "/p/$projectId" });
    },
    [navigate],
  );

  const closeSidebar = () => {
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-sidebar-toggle")?.focus();
    });
  };

  const closeInspector = () => {
    setInspectorOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-inspector-toggle")?.focus();
    });
  };

  const launchTurnHasAuthoritativeUserMessage = taskLaunchState?.turn.id
    ? runtime.snapshot?.turns
        .find((turn) => turn.id === taskLaunchState.turn.id)
        ?.items.some((item) => item.type === "message" && item.role === "user") === true
    : false;

  useEffect(() => {
    if (taskId !== undefined && launchTurnHasAuthoritativeUserMessage) {
      queryClient.removeQueries({
        exact: true,
        queryKey: taskLaunchQueryKey(projectId, taskId),
      });
    }
  }, [launchTurnHasAuthoritativeUserMessage, projectId, queryClient, taskId]);

  useEffect(() => {
    const activeSnapshot = runtime.snapshot;
    if (taskId === undefined || activeSnapshot === undefined) {
      return;
    }
    // 首个 Assistant Item 出现即移除“新聊天”，Turn 结束后再由服务端正式标题校准。
    queryClient.setQueryData<ProjectTaskInfiniteData>(
      ["projects", projectId, "tasks"],
      (currentData) => updateNewTaskTitleFromSnapshotInInfiniteData(currentData, activeSnapshot),
    );
  }, [projectId, queryClient, runtime.snapshot, taskId]);

  useEffect(() => {
    // 窗口缩窄进入覆盖模式时关闭桌面面板，避免两个抽屉同时遮住主内容。
    const sidebarMedia = window.matchMedia(sidebarOverlayQuery);
    const inspectorMedia = window.matchMedia(inspectorOverlayQuery);
    const syncOverlayPanels = () => {
      if (sidebarMedia.matches) {
        setSidebarOpen(false);
      }
      if (inspectorMedia.matches) {
        setInspectorOpen(false);
      }
    };

    sidebarMedia.addEventListener("change", syncOverlayPanels);
    inspectorMedia.addEventListener("change", syncOverlayPanels);
    return () => {
      sidebarMedia.removeEventListener("change", syncOverlayPanels);
      inspectorMedia.removeEventListener("change", syncOverlayPanels);
    };
  }, []);

  return (
    <div
      className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
      data-inspector-open={inspectorOpen}
      data-sidebar-open={sidebarOpen}
      ref={workbenchShellRef}
      style={
        {
          "--inspector-open-width": `${String(inspectorWidth)}px`,
          "--sidebar-open-width": `${String(sidebarWidth)}px`,
        } as WorkbenchShellStyle
      }
    >
      <ProjectSidebar
        connectionState={sidebarConnectionState}
        onClose={closeSidebar}
        onOpenSettings={() => {
          setGlobalSettingsOpen(true);
        }}
        projectId={projectId}
        {...(taskId === undefined && pendingTaskSelection?.projectId === projectId
          ? { taskId: pendingTaskSelection.taskId }
          : taskId === undefined
            ? {}
            : { taskId })}
      />

      {sidebarOpen ? (
        <Button
          variant="ghost"
          aria-label={t("shell.closeSidebar")}
          className="workbench-sidebar-scrim"
          onClick={closeSidebar}
          type="button"
        />
      ) : null}

      {sidebarOpen ? (
        <WorkbenchPanelResizer
          direction={1}
          label={t("shell.resizeSidebar")}
          maximumWidth={sidebarWidthLimits.maximum}
          minimumWidth={sidebarWidthLimits.minimum}
          onResize={(width) => {
            workbenchShellRef.current?.style.setProperty(
              "--sidebar-open-width",
              `${String(width)}px`,
            );
          }}
          onResizeEnd={(width) => {
            workbenchShellRef.current?.removeAttribute("data-resizing-panel");
            setSidebarWidth(width);
          }}
          onResizeStart={() => {
            workbenchShellRef.current?.setAttribute("data-resizing-panel", "sidebar");
          }}
          panel="sidebar"
          width={sidebarWidth}
        />
      ) : null}

      <main aria-label={t("shell.timeline")} className="flex min-h-0 min-w-0 flex-col bg-content">
        <header className="flex h-workbench-header shrink-0 items-center justify-between gap-3 bg-content px-2.5 shadow-toolbar sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip key={sidebarOpen ? "sidebar-open" : "sidebar-closed"}>
              <TooltipTrigger asChild>
                <Button
                  aria-label={sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")}
                  id="workbench-sidebar-toggle"
                  onClick={() => {
                    setSidebarOpen((open) => !open);
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <PanelLeft className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")}
              </TooltipContent>
            </Tooltip>
            <h1
              aria-label={title}
              className="min-w-0 text-body-small font-semibold text-foreground"
            >
              {taskId === undefined ? (
                <span className="block truncate">{title}</span>
              ) : (
                <Button
                  variant="ghost"
                  aria-label={t("shell.renameTask", { title })}
                  className="group flex max-w-full items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-control-hover focus-visible:shadow-focus"
                  id="workbench-task-title-rename"
                  onClick={() => {
                    setTaskRenameError(null);
                    setTaskRenameOpen(true);
                  }}
                  type="button"
                >
                  <span className="truncate">{title}</span>
                  <Pencil
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  />
                </Button>
              )}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip key={inspectorOpen ? "inspector-open" : "inspector-closed"}>
              <TooltipTrigger asChild>
                <Button
                  aria-label={
                    inspectorOpen ? t("shell.collapseInspector") : t("shell.expandInspector")
                  }
                  id="workbench-inspector-toggle"
                  onClick={() => {
                    setInspectorOpen((open) => !open);
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <PanelRight className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {inspectorOpen ? t("shell.collapseInspector") : t("shell.expandInspector")}
              </TooltipContent>
            </Tooltip>
          </div>
        </header>

        {error !== null ||
        (projectTaskState?.error ?? null) !== null ||
        modelsQuery.error !== null ||
        skillsQuery.error !== null ||
        projectDefaultsQuery.error !== null ||
        (taskId === undefined && globalSettingsQuery.error !== null) ? (
          <RuntimeUnavailable onRetry={() => void retry()} />
        ) : taskId === undefined ? (
          <>
            <TaskTimeline
              onProjectChange={handleNewTaskProjectChange}
              projectId={projectId}
              projects={projects}
              {...(newChatSubmissionStartedAt === undefined
                ? {}
                : { submissionStartedAt: newChatSubmissionStartedAt })}
            />
            <WorkbenchComposer
              capabilities={capabilities}
              client={client}
              followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
              models={models}
              modelsError={null}
              modelsPending={
                modelsQuery.isPending ||
                projectDefaultsQuery.isPending ||
                globalSettingsQuery.isPending
              }
              onSettingsChange={updateDraftSettings}
              onRequestNotificationPermission={requestNotificationPermission}
              onDirectSubmission={beginNewChatSubmission}
              onSubmissionStateChange={handleNewChatSubmissionStateChange}
              onTaskCreated={handleTaskCreated}
              onTaskStarted={handleTaskStarted}
              projectId={projectId}
              projectPath={projectPath}
              {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
              settings={draftSettings}
              skills={skillsQuery.data?.data ?? []}
            />
          </>
        ) : (
          <ActiveTaskWorkbench
            capabilities={capabilities}
            client={client}
            fallbackSettings={draftSettings}
            followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
            models={models}
            modelsError={modelsQuery.error}
            modelsPending={modelsQuery.isPending}
            onRequestNotificationPermission={requestNotificationPermission}
            onTaskStarted={handleTaskStarted}
            projectId={projectId}
            projectPath={projectPath}
            {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
            runtime={runtime}
            skills={skillsQuery.data?.data ?? []}
            startingSnapshot={startingSnapshot}
            startingPrompt={taskLaunchState}
            taskId={taskId}
            onOpenFileDiff={openFileDiff}
            onOpenSourceFile={openMessageFileReference}
            onReviewFileChanges={openFileReview}
          />
        )}
      </main>

      {inspectorOpen ? (
        <Button
          variant="ghost"
          aria-label={t("shell.closeInspector")}
          className="workbench-inspector-scrim"
          onClick={closeInspector}
          type="button"
        />
      ) : null}

      {inspectorOpen ? (
        <WorkbenchPanelResizer
          direction={-1}
          label={t("shell.resizeInspector")}
          maximumWidth={inspectorWidthLimits.maximum}
          minimumWidth={inspectorWidthLimits.minimum}
          onResize={(width) => {
            workbenchShellRef.current?.style.setProperty(
              "--inspector-open-width",
              `${String(width)}px`,
            );
          }}
          onResizeEnd={(width) => {
            workbenchShellRef.current?.removeAttribute("data-resizing-panel");
            setInspectorWidth(width);
          }}
          onResizeStart={() => {
            workbenchShellRef.current?.setAttribute("data-resizing-panel", "inspector");
          }}
          panel="inspector"
          width={inspectorWidth}
        />
      ) : null}

      <WorkbenchInspector
        backgroundTerminals={backgroundTerminals.terminals}
        backgroundTerminalsError={backgroundTerminals.error}
        backgroundTerminalsPending={backgroundTerminals.isPending}
        expandedFileTreePaths={expandedFileTreePaths}
        fileTreeDirectories={fileTreeDirectories}
        gitStatusError={gitStatusQuery.error}
        gitStatusPending={gitStatusQuery.isPending}
        gitStatusRefreshing={gitStatusQuery.isFetching}
        mcpServers={mcpServersQuery.data?.data ?? []}
        mcpServersError={mcpServersQuery.error}
        mcpServersPending={mcpServersQuery.isPending}
        key={`${projectId}:${taskId ?? "draft"}:${subagents.length > 0 ? "with-subagents" : "without-subagents"}:${backgroundTerminals.terminals.length > 0 ? "with-terminals" : "without-terminals"}`}
        onClose={closeInspector}
        onFileTreeExpandedChange={(nextExpandedPaths) => {
          setFileTreeExpansion((current) => {
            const previousPaths =
              current.projectId === projectId ? current.paths : emptyExpandedFileTreePaths;
            const collapsedPaths = [...previousPaths].filter(
              (path) => !nextExpandedPaths.has(path),
            );
            return {
              paths: new Set(
                [...nextExpandedPaths].filter(
                  (path) =>
                    !collapsedPaths.some((collapsedPath) => path.startsWith(`${collapsedPath}/`)),
                ),
              ),
              projectId,
            };
          });
        }}
        onOpenFileDiff={openFileDiff}
        onOpenProjectPath={(appId, path) => {
          projectPathOpenMutation.reset();
          void projectPathOpenLockRef.current.run(() =>
            projectPathOpenMutation.mutateAsync({ appId, path }),
          );
        }}
        onOpenProjectFile={(path) => {
          openMessageFileReference({ lineNumber: null, path });
        }}
        onRefreshGitStatus={() => {
          void refreshProjectGitStatus(projectId);
        }}
        onCommitChanges={() => {
          commitChangesLauncherRef.current?.open();
        }}
        onRefreshFileTreeDirectory={(directoryPath) => {
          const directoryIndex = fileTreeDirectoryPaths.indexOf(directoryPath);
          void fileTreeQueries[directoryIndex]?.refetch();
        }}
        onReviewChanges={openFileReview}
        onTerminateBackgroundTerminal={backgroundTerminals.terminateTerminal}
        onOpenSubagent={(selection) => {
          if (taskId !== undefined) {
            setSubagentDialogSelection({ parentTaskId: taskId, projectId, selection });
          }
        }}
        projectName={projectName}
        projectOpenApps={projectOpenCapabilitiesQuery.data?.apps ?? []}
        projectOpenError={projectPathOpenMutation.error}
        projectOpenPending={projectPathOpenMutation.isPending}
        projectPath={projectPath}
        skills={skillsQuery.data?.data ?? []}
        subagents={subagents}
        terminalMutationError={backgroundTerminals.terminalError}
        terminatingTerminalId={backgroundTerminals.terminatingTerminalId}
        {...(inspectorTask === undefined ? {} : { task: inspectorTask })}
        {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
      />
      <FileDiffDialog
        change={selectedFileChange}
        onClose={() => {
          setFileDiffSelection(null);
        }}
      />
      <FileReviewDialog
        changes={selectedFileReview}
        onClose={() => {
          setFileReviewSelection(null);
        }}
      />
      {gitStatusQuery.data === undefined ? null : (
        <CommitChangesLauncher
          client={client}
          gitStatus={gitStatusQuery.data}
          projectId={projectId}
          ref={commitChangesLauncherRef}
        />
      )}
      {selectedSourceFile === null ? null : (
        <Suspense fallback={null}>
          <LazyProjectSourceDialog
            client={client}
            onClose={() => {
              setSourceFileSelection(null);
            }}
            projectId={projectId}
            previewKind={selectedSourceFile.kind}
            reference={selectedSourceFile.reference}
          />
        </Suspense>
      )}
      <SubagentOutputDialog
        onClose={() => {
          setSubagentDialogSelection(null);
        }}
        projectId={projectId}
        projectRuntime={projectRuntime}
        selection={selectedSubagent}
      />
      {taskRenameOpen && taskId !== undefined ? (
        <TaskRenameDialog
          error={taskRenameError}
          initialTitle={title}
          isPending={renameMutation.isPending}
          key={`${projectId}:${taskId}`}
          onClose={closeTaskRenameDialog}
          onRename={(nextTitle) => void renameActiveTask(nextTitle)}
        />
      ) : null}
      {globalSettingsOpen ? (
        <GlobalSettingsDialog
          {...(access.status === undefined ? {} : { accessMode: access.status.mode })}
          apps={projectOpenCapabilitiesQuery.data?.apps ?? []}
          error={
            globalSettingsQuery.error ?? modelsQuery.error ?? projectOpenCapabilitiesQuery.error
          }
          isPending={
            globalSettingsQuery.isPending ||
            modelsQuery.isPending ||
            projectOpenCapabilitiesQuery.isPending
          }
          models={models}
          onClose={() => {
            setGlobalSettingsOpen(false);
            requestAnimationFrame(() => {
              document.querySelector<HTMLButtonElement>("#global-settings-trigger")?.focus();
            });
          }}
          onLogoutAccess={access.logout}
          onRetry={() =>
            Promise.all([
              globalSettingsQuery.refetch(),
              modelsQuery.refetch(),
              projectOpenCapabilitiesQuery.refetch(),
            ])
          }
          onSave={(settings) => globalSettingsMutation.mutateAsync(settings).then(() => undefined)}
          {...(globalSettingsQuery.data === undefined
            ? {}
            : { settings: globalSettingsQuery.data.settings })}
        />
      ) : null}
    </div>
  );
}

const ActiveTaskWorkbench = memo(function ActiveTaskWorkbench({
  capabilities,
  client,
  fallbackSettings,
  followUpBehavior,
  models,
  modelsError,
  modelsPending,
  onRequestNotificationPermission,
  onTaskStarted,
  projectId,
  projectPath,
  gitStatus,
  runtime,
  skills,
  startingSnapshot,
  startingPrompt,
  taskId,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
}: Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  fallbackSettings: AgentTaskSettings;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onRequestNotificationPermission: () => void;
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
    messageAttachments?: readonly AgentMessageAttachment[],
  ) => void;
  projectId: string;
  projectPath: string;
  gitStatus?: ProjectGitStatus;
  runtime: TaskRuntimeView;
  skills: readonly AgentSkill[];
  startingSnapshot: RuntimeTaskSnapshot | undefined;
  startingPrompt: SubmittedPromptState | undefined;
  taskId: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
}>) {
  const queryClient = useQueryClient();
  const taskScope = `${projectId}:${taskId}`;
  const [timelineScrollToBottomSignal, setTimelineScrollToBottomSignal] = useState(0);
  const {
    beginSubmission,
    getStartedAt: getSubmissionStartedAt,
    handleSubmissionStateChange,
    startedAt: submissionStartedAt,
  } = useSubmissionStartedAt();
  const [submittedPromptState, setSubmittedPromptState] = useState<{
    prompt: SubmittedPromptState | undefined;
    taskScope: string;
  }>(() => ({ prompt: startingPrompt, taskScope }));
  const submittedPrompt =
    submittedPromptState.taskScope === taskScope ? submittedPromptState.prompt : startingPrompt;
  const retainedSubmissionStartedAt = submissionStartedAt ?? submittedPrompt?.submissionStartedAt;
  const retainedSubmissionTurnId =
    submissionStartedAt === undefined ? submittedPrompt?.turn.id : undefined;
  const visibleSnapshot =
    runtime.snapshot === undefined || submittedPrompt === undefined
      ? runtime.snapshot
      : mergeSubmittedPromptIntoSnapshot(runtime.snapshot, submittedPrompt.turn, {
          ...submittedPrompt.input,
          messageAttachments: submittedPrompt.messageAttachments,
        });
  const visibleRuntime: TaskRuntimeView =
    visibleSnapshot === runtime.snapshot ? runtime : { ...runtime, snapshot: visibleSnapshot };
  useEffect(() => {
    const store = runtime.store;
    if (store === undefined || submittedPrompt === undefined) {
      return;
    }
    const state = store.getState();
    const currentSnapshot = state.reconstructSnapshot();
    if (currentSnapshot === undefined || state.checkpoint === null) {
      return;
    }
    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(currentSnapshot, submittedPrompt.turn, {
      ...submittedPrompt.input,
      messageAttachments: submittedPrompt.messageAttachments,
    });
    if (mergedSnapshot === currentSnapshot) {
      return;
    }
    // Snapshot 尚未包含本次提交时写入归一化 Store，由权威用户 Item 到达后原子接管。
    const previousConnectionState = state.connectionState;
    const previousError = state.error;
    state.hydrate({ checkpoint: state.checkpoint, snapshot: mergedSnapshot });
    store.getState().setConnectionState(previousConnectionState);
    store.getState().setError(previousError);
  }, [runtime.snapshot, runtime.store, submittedPrompt]);
  const settingsMutation = useMutation({
    ...taskSettingsMutationOptions(projectId, taskId, client),
    onSuccess(response) {
      queryClient.setQueryData<AgentTaskSnapshotResponse>(
        ["projects", projectId, "tasks", taskId],
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                snapshot: { ...current.snapshot, settings: response.settings },
              },
      );
    },
  });
  const resolvePendingRequest = (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => client.resolvePendingRequest(request, resolution, { idempotencyKey }).then(() => undefined);
  const rollbackTurn = async (turnId: string, idempotencyKey: string) => {
    await client.rollbackTurn(projectId, taskId, turnId, { idempotencyKey });
    // Codex 回滚不会发送统一事件；成功后主动刷新会话与工作区状态。
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["projects", projectId, "tasks", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "git-status"] }),
    ]);
  };
  const forkTask = async (idempotencyKey: string) => {
    const response = await client.forkTask(projectId, taskId, { idempotencyKey });
    // 复用统一的新任务入口，保证列表缓存先于路由切换更新。
    onTaskStarted(response.task);
  };

  return (
    <>
      <TaskTimeline
        canRollbackTurns={capabilities?.turns.rollback ?? false}
        {...(capabilities?.tasks.fork === true ? { onForkTask: forkTask } : {})}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onReviewFileChanges={onReviewFileChanges}
        onResolvePendingRequest={resolvePendingRequest}
        onRollbackTurn={rollbackTurn}
        projectId={projectId}
        key={taskScope}
        runtime={visibleRuntime}
        scrollToBottomSignal={timelineScrollToBottomSignal}
        {...(retainedSubmissionStartedAt === undefined
          ? {}
          : { submissionStartedAt: retainedSubmissionStartedAt })}
        {...(retainedSubmissionTurnId === undefined
          ? {}
          : { submissionTurnId: retainedSubmissionTurnId })}
        taskId={taskId}
        {...(startingSnapshot === undefined ? {} : { startingSnapshot })}
      />
      <WorkbenchComposer
        capabilities={capabilities}
        client={client}
        followUpBehavior={followUpBehavior}
        models={models}
        modelsError={modelsError}
        modelsPending={modelsPending || runtime.isPending}
        onDirectSubmission={() => {
          beginSubmission();
          setTimelineScrollToBottomSignal((current) => current + 1);
        }}
        onRequestNotificationPermission={onRequestNotificationPermission}
        onSettingsChange={(settings) =>
          settingsMutation.mutateAsync(settings).then(() => undefined)
        }
        onSubmissionStateChange={handleSubmissionStateChange}
        onTaskStarted={onTaskStarted}
        onTurnStarted={(turn, input, messageAttachments) => {
          const confirmedStartedAt = getSubmissionStartedAt() ?? turn.startedAt;
          setSubmittedPromptState({
            prompt: {
              input,
              messageAttachments,
              ...(confirmedStartedAt === null ? {} : { submissionStartedAt: confirmedStartedAt }),
              turn,
            },
            taskScope,
          });
        }}
        projectId={projectId}
        projectPath={projectPath}
        {...(gitStatus === undefined ? {} : { gitStatus })}
        runtime={visibleRuntime}
        settings={visibleSnapshot?.settings ?? startingSnapshot?.settings ?? fallbackSettings}
        skills={skills}
        taskId={taskId}
      />
    </>
  );
});
