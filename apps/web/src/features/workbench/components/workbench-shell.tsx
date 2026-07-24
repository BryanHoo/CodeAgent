import type { AgentCapabilities, AgentModel, PendingRequest } from "@code-agent/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, ExternalLink, PanelLeft, PanelRight } from "lucide-react";

import { useProjects } from "../../projects/project-context.js";
import {
  useTaskRuntime,
  type TaskRuntimeView,
} from "../../conversation/runtime/use-task-runtime.js";
import { FileDiffDialog } from "../../diff/file-diff-dialog.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  modelsQueryOptions,
  projectGitStatusQueryOptions,
} from "../../projects/project-queries.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { ProjectSidebar } from "./project-sidebar.js";
import { ProjectSourceDialog } from "./project-source-dialog.js";
import { TaskTimeline } from "./task-timeline.js";
import type { PendingRequestResolution } from "./pending-request.js";
import { WorkbenchComposer } from "./workbench-composer.js";
import { WorkbenchInspector } from "./workbench-inspector.js";

const sidebarOverlayQuery = "(max-width: 760px)";
const inspectorOverlayQuery = "(max-width: 1100px)";

type WorkbenchShellProps = Readonly<{
  projectId: string;
  taskId?: string;
}>;

function shouldOpenDesktopPanel(query: string) {
  return typeof window === "undefined" || !window.matchMedia(query).matches;
}

export function WorkbenchShell({ projectId, taskId }: WorkbenchShellProps) {
  const { capabilities, client, projects, tasks } = useProjects();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const modelsQuery = useQuery(modelsQueryOptions(client));
  const runtime = useTaskRuntime(taskId, client);
  const isTaskRunning = runtime.snapshot?.status === "running";
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
  const [sourceFileSelection, setSourceFileSelection] = useState<{
    projectId: string;
    reference: MessageFileReference;
  } | null>(null);
  const project = projects.find((item) => item.id === projectId);
  const projectName = project?.name ?? projectId;
  const projectPath = project?.rootPath ?? projectId;
  const title = tasks.find((task) => task.id === taskId)?.title ?? taskId ?? "New agent";
  const selectedFileChange =
    fileDiffSelection !== null && fileDiffSelection.projectId === projectId
      ? fileDiffSelection.change
      : null;
  const selectedSourceFile =
    sourceFileSelection !== null && sourceFileSelection.projectId === projectId
      ? sourceFileSelection.reference
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
    if (previousTaskRunningRef.current && !isTaskRunning) {
      // 停止轮询前补读一次，确保最后一批落盘变更不会停留在上个采样周期。
      void gitStatusQuery.refetch();
    }
    previousTaskRunningRef.current = isTaskRunning;
  }, [gitStatusQuery.refetch, isTaskRunning]);

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

        {taskId === undefined ? (
          <>
            <TaskTimeline projectName={projectName} />
            <WorkbenchComposer
              capabilities={capabilities}
              client={client}
              models={modelsQuery.data?.data ?? []}
              modelsError={modelsQuery.error}
              modelsPending={modelsQuery.isPending}
              onTaskStarted={(startedTaskId) => {
                void queryClient.invalidateQueries({
                  queryKey: ["projects", projectId, "tasks"],
                });
                void navigate({
                  params: { projectId, taskId: startedTaskId },
                  to: "/p/$projectId/t/$taskId",
                });
              }}
              projectId={projectId}
              projectPath={projectPath}
            />
          </>
        ) : (
          <ActiveTaskWorkbench
            capabilities={capabilities}
            client={client}
            models={modelsQuery.data?.data ?? []}
            modelsError={modelsQuery.error}
            modelsPending={modelsQuery.isPending}
            key={taskId}
            projectId={projectId}
            projectName={projectName}
            projectPath={projectPath}
            runtime={runtime}
            taskId={taskId}
            onOpenFileDiff={openFileDiff}
            onOpenSourceFile={openSourceFile}
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
  models,
  modelsError,
  modelsPending,
  projectId,
  projectName,
  projectPath,
  runtime,
  taskId,
  onOpenFileDiff,
  onOpenSourceFile,
}: Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  projectId: string;
  projectName: string;
  projectPath: string;
  runtime: TaskRuntimeView;
  taskId: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
}>) {
  const resolvePendingRequest = (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => client.resolvePendingRequest(request, resolution, { idempotencyKey }).then(() => undefined);

  return (
    <>
      <TaskTimeline
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onResolvePendingRequest={resolvePendingRequest}
        projectName={projectName}
        runtime={runtime}
        taskId={taskId}
      />
      <WorkbenchComposer
        capabilities={capabilities}
        client={client}
        models={models}
        modelsError={modelsError}
        modelsPending={modelsPending}
        onTaskStarted={() => undefined}
        projectId={projectId}
        projectPath={projectPath}
        runtime={runtime}
        taskId={taskId}
      />
    </>
  );
}
