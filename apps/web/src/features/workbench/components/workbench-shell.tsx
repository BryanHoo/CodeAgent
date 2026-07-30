import type {
  AgentCapabilities,
  AgentModel,
  AgentPromptInput,
  AgentProjectDefaults,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
  AgentTaskSnapshotResponse,
  AgentTurn,
  PendingRequest,
  ProjectGitStatus,
} from "@code-agent/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ellipsis, ExternalLink, PanelLeft, PanelRight } from "lucide-react";

import { useProjects } from "../../projects/project-context.js";
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
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  modelsQueryOptions,
  PROJECT_TASK_SEARCH_SOURCE_KEY,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectGitStatusQueryOptions,
  skillsQueryOptions,
  taskSettingsMutationOptions,
  updateNewTaskTitleFromSnapshotInInfiniteData,
  upsertProjectTaskInInfiniteData,
  type ProjectTaskInfiniteData,
} from "../../projects/project-queries.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import { RuntimeUnavailable } from "../../../shared/ui/runtime-unavailable.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { deriveProjectSidebarConnectionState, ProjectSidebar } from "./project-sidebar.js";
import { collectSubagents, type SubagentSelection } from "./subagent.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { TaskTimeline } from "./task-timeline.js";
import type { PendingRequestResolution } from "./pending-request.js";
import { WorkbenchComposer } from "./workbench-composer.js";
import { WorkbenchInspector } from "./workbench-inspector.js";
import { useBackgroundTerminals } from "../hooks/use-background-terminals.js";

const sidebarOverlayQuery = "(max-width: 760px)";
const inspectorOverlayQuery = "(max-width: 1100px)";

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
  settings: AgentTaskSettings;
  task: AgentTask;
  turn: AgentTurn;
}>;

type SubmittedPromptState = Readonly<{
  input: AgentPromptInput;
  turn: AgentTurn;
}>;

type WorkbenchShellProps = Readonly<{
  projectId: string;
  taskId?: string;
}>;

function shouldOpenDesktopPanel(query: string) {
  return typeof window === "undefined" || !window.matchMedia(query).matches;
}

export function WorkbenchShell({ projectId, taskId }: WorkbenchShellProps) {
  const {
    capabilities,
    client,
    error,
    isPending,
    markTaskRunning,
    projectRuntime,
    projects,
    projectTaskStates,
    requestNotificationPermission,
    retry,
    tasks,
    viewTask,
  } = useProjects();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const modelsQuery = useQuery(modelsQueryOptions(client));
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
  const runtime = useTaskRuntime(projectId, taskId, projectRuntime);
  const taskLaunchState =
    taskId === undefined
      ? undefined
      : queryClient.getQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, taskId));
  const startingSnapshot: RuntimeTaskSnapshot | undefined =
    taskLaunchState !== undefined
      ? mergeSubmittedPromptIntoSnapshot(
          {
            ...taskLaunchState.task,
            contextUsage: null,
            pendingRequests: [],
            settings: taskLaunchState.settings,
            status: "running",
            turns: [taskLaunchState.turn],
          },
          taskLaunchState.turn,
          taskLaunchState.input,
        )
      : undefined;
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
  const gitStatusQuery = useQuery(projectGitStatusQueryOptions(projectId, isTaskRunning, client));
  const previousTaskRunningRef = useRef(isTaskRunning);
  // 窄屏首次进入时保持主时间线可见，面板由工具栏按需打开。
  const [sidebarOpen, setSidebarOpen] = useState(() => shouldOpenDesktopPanel(sidebarOverlayQuery));
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    shouldOpenDesktopPanel(inspectorOverlayQuery),
  );
  const [fileDiffSelection, setFileDiffSelection] = useState<{
    change: AgentFileChange;
    projectId: string;
  } | null>(null);
  const [fileReviewSelection, setFileReviewSelection] = useState<{
    changes: readonly AgentFileChange[];
    projectId: string;
  } | null>(null);
  const [sourceFileSelection, setSourceFileSelection] = useState<{
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
    "新聊天";
  const selectedFileChange =
    fileDiffSelection !== null && fileDiffSelection.projectId === projectId
      ? fileDiffSelection.change
      : null;
  const selectedSourceFile =
    sourceFileSelection !== null && sourceFileSelection.projectId === projectId
      ? sourceFileSelection.reference
      : null;
  const selectedFileReview =
    fileReviewSelection !== null && fileReviewSelection.projectId === projectId
      ? fileReviewSelection.changes
      : null;
  const subagents = collectSubagents(runtime.snapshot ?? startingSnapshot);
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
  const openFileDiff = (change: AgentFileChange) => {
    setFileDiffSelection({ change, projectId });
  };
  const openSourceFile = useCallback(
    (reference: MessageFileReference) => {
      void loadProjectSourceDialog();
      setSourceFileSelection({ projectId, reference });
    },
    [projectId],
  );
  const openFileReview = (changes: readonly AgentFileChange[]) => {
    setFileReviewSelection({ changes, projectId });
  };
  const handleTaskStarted = useCallback(
    (
      startedTask: AgentTask,
      startedTurn?: AgentTurn,
      startedInput?: AgentPromptInput,
      settings?: AgentTaskSettings,
    ) => {
      // Mutation 返回即代表 Task 已创建，先写列表缓存再导航，不能等待最终一致的列表刷新。
      queryClient.setQueryData<ProjectTaskInfiniteData>(
        ["projects", projectId, "tasks"],
        (currentData) => upsertProjectTaskInInfiniteData(currentData, startedTask),
      );
      queryClient.setQueryData<readonly AgentTask[]>(
        ["projects", projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
        (currentTasks) =>
          currentTasks === undefined
            ? undefined
            : [startedTask, ...currentTasks.filter((task) => task.id !== startedTask.id)],
      );
      if (startedTurn !== undefined && startedInput !== undefined && settings !== undefined) {
        // 跨路由保存首轮启动结果，让 Snapshot 返回前即可渲染用户消息和 AI 运行态。
        queryClient.setQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, startedTask.id), {
          input: startedInput,
          settings,
          task: startedTask,
          turn: startedTurn,
        });
      }
      if (startedTurn !== undefined) {
        // 首轮 Turn 已确认运行，导航前写入 Sidebar 活动态，Review 不需要伪造用户消息。
        markTaskRunning(projectId, startedTask.id);
      }
      void navigate({
        params: { projectId, taskId: startedTask.id },
        to: "/p/$projectId/t/$taskId",
      });
    },
    [markTaskRunning, navigate, projectId, queryClient],
  );
  const models = modelsQuery.data?.data ?? [];
  const defaultModel =
    models.find((model) => model.id === projectDefaultsQuery.data?.settings.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const draftDefaults: AgentProjectDefaults = {
    model: defaultModel?.id ?? projectDefaultsQuery.data?.settings.model ?? "",
    reasoningEffort:
      projectDefaultsQuery.data?.settings.reasoningEffort ??
      defaultModel?.defaultReasoningEffort ??
      "",
    sandboxMode: projectDefaultsQuery.data?.settings.sandboxMode ?? "workspace-write",
  };
  const draftSettings: AgentTaskSettings = {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    ...draftDefaults,
  };
  const inspectorTask = runtime.snapshot ?? startingSnapshot;
  const inspectorSettings = inspectorTask?.settings ?? draftSettings;
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
    if (previousTaskRunningRef.current && !isTaskRunning) {
      // 停止轮询前补读一次，确保最后一批落盘变更不会停留在上个采样周期。
      void gitStatusQuery.refetch();
    }
    previousTaskRunningRef.current = isTaskRunning;
  }, [gitStatusQuery.refetch, isTaskRunning]);

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
    >
      <ProjectSidebar
        connectionState={sidebarConnectionState}
        onClose={closeSidebar}
        projectId={projectId}
        {...(taskId === undefined ? {} : { taskId })}
      />

      {sidebarOpen ? (
        <button
          aria-label="关闭项目侧栏"
          className="workbench-sidebar-scrim"
          onClick={closeSidebar}
          type="button"
        />
      ) : null}

      <main aria-label="Task Timeline" className="flex min-h-0 min-w-0 flex-col bg-content">
        <header className="flex h-workbench-header shrink-0 items-center justify-between gap-3 bg-content px-2.5 shadow-toolbar sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              id="workbench-sidebar-toggle"
              label={sidebarOpen ? "收起项目侧栏" : "展开项目侧栏"}
              onClick={() => {
                setSidebarOpen((open) => !open);
              }}
              size="small"
            >
              <PanelLeft className="size-3.5" aria-hidden="true" />
            </IconButton>
            <h1 className="truncate text-body-small font-semibold text-foreground">{title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              className="hidden h-7 items-center gap-1.5 rounded-control bg-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover sm:inline-flex"
              disabled
              type="button"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              打开位置
            </button>
            <IconButton label="更多操作" size="small">
              <Ellipsis className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              id="workbench-inspector-toggle"
              label={inspectorOpen ? "收起上下文面板" : "展开上下文面板"}
              onClick={() => {
                setInspectorOpen((open) => !open);
              }}
              size="small"
            >
              <PanelRight className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        </header>

        {error !== null ||
        (projectTaskState?.error ?? null) !== null ||
        modelsQuery.error !== null ||
        skillsQuery.error !== null ||
        projectDefaultsQuery.error !== null ? (
          <RuntimeUnavailable onRetry={() => void retry()} />
        ) : taskId === undefined ? (
          <>
            <TaskTimeline
              onProjectChange={handleNewTaskProjectChange}
              projectId={projectId}
              projects={projects}
            />
            <WorkbenchComposer
              capabilities={capabilities}
              client={client}
              models={models}
              modelsError={null}
              modelsPending={modelsQuery.isPending || projectDefaultsQuery.isPending}
              onSettingsChange={updateDraftSettings}
              onRequestNotificationPermission={requestNotificationPermission}
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
            startingPrompt={
              taskLaunchState === undefined
                ? undefined
                : { input: taskLaunchState.input, turn: taskLaunchState.turn }
            }
            taskId={taskId}
            onOpenFileDiff={openFileDiff}
            onOpenSourceFile={openSourceFile}
            onReviewFileChanges={openFileReview}
          />
        )}
      </main>

      {inspectorOpen ? (
        <button
          aria-label="关闭上下文面板"
          className="workbench-inspector-scrim"
          onClick={closeInspector}
          type="button"
        />
      ) : null}

      <WorkbenchInspector
        backgroundTerminals={backgroundTerminals.terminals}
        backgroundTerminalsError={backgroundTerminals.error}
        backgroundTerminalsPending={backgroundTerminals.isPending}
        gitStatusError={gitStatusQuery.error}
        gitStatusPending={gitStatusQuery.isPending}
        key={`${projectId}:${taskId ?? "draft"}:${subagents.length > 0 ? "with-subagents" : "without-subagents"}:${backgroundTerminals.terminals.length > 0 ? "with-terminals" : "without-terminals"}`}
        onOpenFileDiff={openFileDiff}
        onTerminateBackgroundTerminal={backgroundTerminals.terminateTerminal}
        onOpenSubagent={(selection) => {
          if (taskId !== undefined) {
            setSubagentDialogSelection({ parentTaskId: taskId, projectId, selection });
          }
        }}
        projectName={projectName}
        projectPath={projectPath}
        settings={inspectorSettings}
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
      {selectedSourceFile === null ? null : (
        <Suspense fallback={null}>
          <LazyProjectSourceDialog
            client={client}
            onClose={() => {
              setSourceFileSelection(null);
            }}
            projectId={projectId}
            reference={selectedSourceFile}
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
    </div>
  );
}

function ActiveTaskWorkbench({
  capabilities,
  client,
  fallbackSettings,
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
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onRequestNotificationPermission: () => void;
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
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
  const [submittedPromptState, setSubmittedPromptState] = useState<{
    prompt: SubmittedPromptState | undefined;
    taskScope: string;
  }>(() => ({ prompt: startingPrompt, taskScope }));
  const submittedPrompt =
    submittedPromptState.taskScope === taskScope ? submittedPromptState.prompt : startingPrompt;
  const visibleSnapshot =
    runtime.snapshot === undefined || submittedPrompt === undefined
      ? runtime.snapshot
      : mergeSubmittedPromptIntoSnapshot(
          runtime.snapshot,
          submittedPrompt.turn,
          submittedPrompt.input,
        );
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
    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(
      currentSnapshot,
      submittedPrompt.turn,
      submittedPrompt.input,
    );
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
        taskId={taskId}
        {...(startingSnapshot === undefined ? {} : { startingSnapshot })}
      />
      <WorkbenchComposer
        capabilities={capabilities}
        client={client}
        models={models}
        modelsError={modelsError}
        modelsPending={modelsPending || runtime.isPending}
        onRequestNotificationPermission={onRequestNotificationPermission}
        onSettingsChange={(settings) =>
          settingsMutation.mutateAsync(settings).then(() => undefined)
        }
        onTaskStarted={onTaskStarted}
        onTurnStarted={(turn, input) => {
          setSubmittedPromptState({ prompt: { input, turn }, taskScope });
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
}
