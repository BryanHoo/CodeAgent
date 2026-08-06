import { TEMPORARY_TASK_SANDBOX_MODE } from "@code-agent/protocol";
import { PanelLeft, PanelRight, Pencil } from "lucide-react";
import { lazy, Suspense, type CSSProperties } from "react";

import { Button } from "../../../shared/ui/button.js";
import { RuntimeUnavailable } from "../../../shared/ui/runtime-unavailable.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
import { ProjectSidebar } from "./project-sidebar.js";
import { TaskTimeline } from "./task-timeline.js";
import { WorkbenchComposer } from "./workbench-composer.js";
import { WorkbenchPanelResizer } from "./workbench-panel-resizer.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellDialogs } from "./workbench-shell-dialogs.js";
import { loadWorkbenchInspector } from "./workbench-shell-runtime.js";
import { ActiveTaskWorkbench } from "./workbench-shell-active-task.js";

const sidebarWidthLimits = { default: 288, maximum: 400, minimum: 220 } as const;
const inspectorWidthLimits = { default: 288, maximum: 480, minimum: 260 } as const;
const emptyExpandedFileTreePaths = new Set<string>();

const LazyWorkbenchInspector = lazy(() =>
  loadWorkbenchInspector().then((module) => ({ default: module.WorkbenchInspector })),
);

type WorkbenchShellStyle = CSSProperties &
  Readonly<{ "--inspector-open-width": string; "--sidebar-open-width": string }>;

export function WorkbenchShellLayout({
  context,
  projectId,
  taskId,
  temporary,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  taskId?: string;
  temporary: boolean;
}>) {
  const {
    appInfoQuery,
    backgroundTerminals,
    beginNewChatSubmission,
    capabilities,
    client,
    closeInspector,
    closeSidebar,
    commitChangesLauncherRef,
    draftSettings,
    error,
    expandedFileTreePaths,
    fileTreeDirectories,
    fileTreeDirectoryPaths,
    fileTreeQueries,
    gitStatusQuery,
    globalSettings,
    globalSettingsQuery,
    handleNewChatSubmissionStateChange,
    handleNewTaskProjectChange,
    handleTaskCreated,
    handleTaskStarted,
    inspectorOpen,
    inspectorTab,
    inspectorTask,
    inspectorWidth,
    mcpServersQuery,
    models,
    modelsQuery,
    newChatSubmissionStartedAt,
    openFileDiff,
    openFileReview,
    openMessageFileReference,
    pendingTaskSelection,
    projectDefaultsQuery,
    projectName,
    projectOpenCapabilitiesQuery,
    projectPath,
    projectPathOpenLockRef,
    projectPathOpenMutation,
    projectTaskState,
    projects,
    refreshProjectGitStatus,
    requestNotificationPermission,
    retry,
    runtime,
    setFileTreeExpansion,
    setGlobalSettingsOpen,
    setGitHistoryOpen,
    setInspectorOpen,
    setInspectorTab,
    setInspectorWidth,
    setSidebarOpen,
    setSidebarWidth,
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
    title,
    updateDraftSettings,
    workbenchShellRef,
    t,
  } = context;
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
        {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
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
        (!temporary && projectDefaultsQuery.error !== null) ||
        (taskId === undefined && globalSettingsQuery.error !== null) ? (
          <RuntimeUnavailable onRetry={() => void retry()} />
        ) : taskId === undefined ? (
          <>
            {temporary ? (
              <TaskTimeline
                projectId={projectId}
                scopeName={t("shell.temporaryTask")}
                temporary
                {...(newChatSubmissionStartedAt === undefined
                  ? {}
                  : { submissionStartedAt: newChatSubmissionStartedAt })}
              />
            ) : (
              <TaskTimeline
                onProjectChange={handleNewTaskProjectChange}
                projectId={projectId}
                projects={projects}
                {...(newChatSubmissionStartedAt === undefined
                  ? {}
                  : { submissionStartedAt: newChatSubmissionStartedAt })}
              />
            )}
            <WorkbenchComposer
              capabilities={capabilities}
              client={client}
              {...(temporary ? { fixedSandboxMode: TEMPORARY_TASK_SANDBOX_MODE } : {})}
              followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
              models={models}
              modelsError={null}
              modelsPending={
                modelsQuery.isPending ||
                (!temporary && projectDefaultsQuery.isPending) ||
                globalSettingsQuery.isPending
              }
              onSettingsChange={updateDraftSettings}
              onOpenGitHistory={() => {
                setGitHistoryOpen(true);
              }}
              onRequestNotificationPermission={requestNotificationPermission}
              onDirectSubmission={beginNewChatSubmission}
              onSubmissionStateChange={handleNewChatSubmissionStateChange}
              onTaskCreated={handleTaskCreated}
              onTaskStarted={handleTaskStarted}
              projectId={projectId}
              projectPath={projectPath}
              projectToolsEnabled={!temporary}
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
            {...(temporary ? { fixedSandboxMode: TEMPORARY_TASK_SANDBOX_MODE } : {})}
            followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
            models={models}
            modelsError={modelsQuery.error}
            modelsPending={modelsQuery.isPending}
            onRequestNotificationPermission={requestNotificationPermission}
            onOpenGitHistory={() => {
              setGitHistoryOpen(true);
            }}
            onTaskStarted={handleTaskStarted}
            projectId={projectId}
            projectPath={projectPath}
            projectToolsEnabled={!temporary}
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

      {inspectorOpen ? (
        <Suspense fallback={null}>
          <LazyWorkbenchInspector
            backgroundTerminals={backgroundTerminals.terminals}
            backgroundTerminalsError={backgroundTerminals.error}
            backgroundTerminalsPending={backgroundTerminals.isPending}
            contextOnly={temporary}
            expandedFileTreePaths={expandedFileTreePaths}
            fileTreeDirectories={fileTreeDirectories}
            gitStatusError={gitStatusQuery.error}
            gitStatusPending={gitStatusQuery.isPending}
            gitStatusRefreshing={gitStatusQuery.isFetching}
            mcpServers={mcpServersQuery.data?.data ?? []}
            mcpServersError={mcpServersQuery.error}
            mcpServersPending={taskId !== undefined && mcpServersQuery.isPending}
            key={`${projectId}:${taskId ?? "draft"}`}
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
                        !collapsedPaths.some((collapsedPath) =>
                          path.startsWith(`${collapsedPath}/`),
                        ),
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
            onTabChange={setInspectorTab}
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
            tab={temporary ? "context" : inspectorTab}
            terminalMutationError={backgroundTerminals.terminalError}
            terminatingTerminalId={backgroundTerminals.terminatingTerminalId}
            {...(inspectorTask === undefined ? {} : { task: inspectorTask })}
            {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
          />
        </Suspense>
      ) : null}
      <WorkbenchShellDialogs
        context={context}
        projectId={projectId}
        projectToolsEnabled={!temporary}
        {...(taskId === undefined ? {} : { taskId })}
      />
    </div>
  );
}
