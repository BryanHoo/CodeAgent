import type {
  AgentCapabilities,
  AgentModel,
  AgentPromptInput,
  AgentProjectDefaults,
  AgentTask,
  AgentTaskPage,
  AgentTaskSettings,
  AgentTaskSnapshotResponse,
  AgentTurn,
  PendingRequest,
} from "@code-agent/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, ExternalLink, PanelLeft, PanelRight } from "lucide-react";

import { useProjects } from "../../projects/project-context.js";
import {
  useTaskRuntime,
  type TaskRuntimeView,
} from "../../conversation/runtime/use-task-runtime.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { FileDiffDialog } from "../../diff/file-diff-dialog.js";
import { FileReviewDialog } from "../../diff/file-review-dialog.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  modelsQueryOptions,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectGitStatusQueryOptions,
  taskSettingsMutationOptions,
  upsertProjectTaskPage,
} from "../../projects/project-queries.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import { RuntimeUnavailable } from "../../../shared/ui/runtime-unavailable.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { deriveProjectSidebarConnectionState, ProjectSidebar } from "./project-sidebar.js";
import { ProjectSourceDialog } from "./project-source-dialog.js";
import { TaskTimeline } from "./task-timeline.js";
import type { PendingRequestResolution } from "./pending-request.js";
import { WorkbenchComposer } from "./workbench-composer.js";
import { WorkbenchInspector } from "./workbench-inspector.js";

const sidebarOverlayQuery = "(max-width: 760px)";
const inspectorOverlayQuery = "(max-width: 1100px)";

function taskLaunchQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "launch"] as const;
}

type TaskLaunchState = Readonly<{
  input: AgentPromptInput;
  settings: AgentTaskSettings;
  task: AgentTask;
  turn: AgentTurn;
}>;

function createStartingTurn(launchState: TaskLaunchState): AgentTurn {
  const alreadyContainsUserMessage = launchState.turn.items.some(
    (item) => item.type === "message" && item.role === "user",
  );
  if (alreadyContainsUserMessage || launchState.input.text.length === 0) {
    return launchState.turn;
  }

  // turn/start 可能只返回空运行态；先补入本次提交，保证用户消息始终排在思考状态之前。
  return {
    ...launchState.turn,
    items: [
      {
        id: `submitted-user-${launchState.turn.id}`,
        role: "user",
        text: launchState.input.text,
        type: "message",
      },
      ...launchState.turn.items,
    ],
  };
}

type WorkbenchShellProps = Readonly<{
  projectId: string;
  taskId?: string;
}>;

function shouldOpenDesktopPanel(query: string) {
  return typeof window === "undefined" || !window.matchMedia(query).matches;
}

export function WorkbenchShell({ projectId, taskId }: WorkbenchShellProps) {
  const { capabilities, client, error, isPending, projects, projectTaskStates, retry, tasks } =
    useProjects();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const modelsQuery = useQuery(modelsQueryOptions(client));
  const projectDefaultsQuery = useQuery(projectDefaultsQueryOptions(projectId, client));
  const projectDefaultsMutation = useMutation({
    ...projectDefaultsMutationOptions(projectId, client),
    onSuccess(response) {
      queryClient.setQueryData(["projects", projectId, "defaults"], response);
    },
  });
  const runtime = useTaskRuntime(projectId, taskId, client);
  const taskLaunchState =
    taskId === undefined
      ? undefined
      : queryClient.getQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, taskId));
  const startingSnapshot: RuntimeTaskSnapshot | undefined =
    runtime.snapshot === undefined && taskLaunchState !== undefined
      ? {
          ...taskLaunchState.task,
          contextUsage: null,
          pendingRequests: [],
          settings: taskLaunchState.settings,
          status: "running",
          turns: [createStartingTurn(taskLaunchState)],
        }
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
  const openFileDiff = (change: AgentFileChange) => {
    setFileDiffSelection({ change, projectId });
  };
  const openSourceFile = useCallback(
    (reference: MessageFileReference) => {
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
      queryClient.setQueryData<AgentTaskPage>(["projects", projectId, "tasks"], (currentPage) =>
        upsertProjectTaskPage(currentPage, startedTask),
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
      void navigate({
        params: { projectId, taskId: startedTask.id },
        to: "/p/$projectId/t/$taskId",
      });
    },
    [navigate, projectId, queryClient],
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
  };
  const draftSettings: AgentTaskSettings = {
    approvalPolicy: "on-request",
    ...draftDefaults,
  };
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

  useEffect(() => {
    if (taskId !== undefined && runtime.snapshot !== undefined) {
      queryClient.removeQueries({
        exact: true,
        queryKey: taskLaunchQueryKey(projectId, taskId),
      });
    }
  }, [projectId, queryClient, runtime.snapshot, taskId]);

  useEffect(() => {
    if (previousTaskRunningRef.current && !isTaskRunning) {
      // 停止轮询前补读一次，确保最后一批落盘变更不会停留在上个采样周期。
      void gitStatusQuery.refetch();
      // Codex 会在首轮执行期间生成标题，Turn 结束后同步刷新项目 Task 元数据。
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "tasks"] });
    }
    previousTaskRunningRef.current = isTaskRunning;
  }, [gitStatusQuery.refetch, isTaskRunning, projectId, queryClient]);

  useEffect(() => {
    // Escape 统一关闭覆盖面板，避免键盘用户被窄屏抽屉困住。
    const closePanels = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        setInspectorOpen(false);
      }
    };

    window.addEventListener("keydown", closePanels);
    return () => {
      window.removeEventListener("keydown", closePanels);
    };
  }, []);

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
              onTaskStarted={handleTaskStarted}
              projectId={projectId}
              projectPath={projectPath}
              settings={draftSettings}
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
            onTaskStarted={handleTaskStarted}
            key={`${projectId}:${taskId}`}
            projectId={projectId}
            projectPath={projectPath}
            runtime={runtime}
            startingSnapshot={startingSnapshot}
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
        gitStatusError={gitStatusQuery.error}
        gitStatusPending={gitStatusQuery.isPending}
        onOpenFileDiff={openFileDiff}
        projectName={projectName}
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
      <ProjectSourceDialog
        client={client}
        onClose={() => {
          setSourceFileSelection(null);
        }}
        projectId={projectId}
        reference={selectedSourceFile}
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
  onTaskStarted,
  projectId,
  projectPath,
  runtime,
  startingSnapshot,
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
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
  ) => void;
  projectId: string;
  projectPath: string;
  runtime: TaskRuntimeView;
  startingSnapshot: RuntimeTaskSnapshot | undefined;
  taskId: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
}>) {
  const queryClient = useQueryClient();
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

  return (
    <>
      <TaskTimeline
        canRollbackTurns={capabilities?.turns.rollback ?? false}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onReviewFileChanges={onReviewFileChanges}
        onResolvePendingRequest={resolvePendingRequest}
        onRollbackTurn={rollbackTurn}
        runtime={runtime}
        taskId={taskId}
        {...(startingSnapshot === undefined ? {} : { startingSnapshot })}
      />
      <WorkbenchComposer
        capabilities={capabilities}
        client={client}
        models={models}
        modelsError={modelsError}
        modelsPending={modelsPending || runtime.isPending}
        onSettingsChange={(settings) =>
          settingsMutation.mutateAsync(settings).then(() => undefined)
        }
        onTaskStarted={onTaskStarted}
        projectId={projectId}
        projectPath={projectPath}
        runtime={runtime}
        settings={runtime.snapshot?.settings ?? startingSnapshot?.settings ?? fallbackSettings}
        taskId={taskId}
      />
    </>
  );
}
