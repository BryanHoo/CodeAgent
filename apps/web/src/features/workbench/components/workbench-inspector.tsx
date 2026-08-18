import type {
  AgentBackgroundTerminal,
  AgentMcpServer,
  AgentSkill,
  AgentTaskSnapshot,
  ProjectFileSearchEntry,
  ProjectGitStatus,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import { RefreshCw } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { FileTree, FileTreeFolder } from "../../../shared/components/agent/file-tree.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { ProjectOpenContextMenu } from "./project-open-menu.js";
import type { SubagentContextEntry, SubagentSelection } from "./subagent.js";

import {
  ProjectFileTreeNodes,
  ProjectFileTreeRootActions,
  getProjectFileName,
  type ProjectFileTreeDirectoryState,
} from "./workbench-inspector-file-tree.js";
import {
  BackgroundTerminalSection,
  McpServerSection,
  SubagentSection,
} from "./workbench-inspector-sections.js";
import { InspectorSources } from "./workbench-inspector-sources.js";
import { PlanSection } from "./workbench-inspector-plan.js";
import { deriveInspectorGitChangeState } from "./workbench-inspector-git-status.js";
import { InspectorGitChangesSection } from "./workbench-inspector-git-changes.js";
import {
  WorkbenchInspectorHeader,
  type WorkbenchInspectorTab,
} from "./workbench-inspector-tabs.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  deriveWorkbenchInspectorActivation,
  getAvailableWorkbenchInspectorTabs,
} from "../workbench-inspector-activation.js";

export type { ProjectFileTreeDirectoryState } from "./workbench-inspector-file-tree.js";

const emptyExpandedFileTreePaths = new Set<string>();
const emptyFileChangesByPath = new Map<string, AgentFileChange>();

// 次级 Git 面板只在用户首次选择对应标签时下载和执行。
const LazyGitHistoryPanel = lazy(async () => {
  const module = await import("./git-history-panel.js");
  return { default: module.GitHistoryPanel };
});
const LazyWorkbenchInspectorChanges = lazy(async () => {
  const module = await import("./workbench-inspector-changes.js");
  return { default: module.WorkbenchInspectorChanges };
});

type WorkbenchInspectorProps = Readonly<{
  backgroundTerminals?: readonly AgentBackgroundTerminal[];
  backgroundTerminalsError?: Error | null;
  backgroundTerminalsPending?: boolean;
  contextOnly?: boolean;
  expandedFileTreePaths?: Set<string>;
  fileTreeDirectories?: readonly ProjectFileTreeDirectoryState[];
  gitStatus?: ProjectGitStatus;
  gitStatusDetails?: ProjectGitStatus | undefined;
  gitStatusDetailsError?: Error | null;
  gitStatusDetailsPending?: boolean;
  gitStatusError?: Error | null;
  gitStatusPending?: boolean;
  gitStatusRefreshing?: boolean;
  gitClient?: CodeAgentWorkbenchClient;
  mcpServers?: readonly AgentMcpServer[];
  mcpServersError?: Error | null;
  mcpServersPending?: boolean;
  mcpServersRetryAvailable?: boolean;
  mcpServersRefreshing?: boolean;
  mcpServersRetrying?: boolean;
  onFileTreeExpandedChange?: (expandedPaths: Set<string>) => void;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenTaskAttachment?: (attachmentId: string) => void;
  onOpenProjectPath?: (appId: ProjectOpenAppId, path?: string) => void;
  onOpenProjectFile?: (path: string) => void;
  onReferenceProjectPath?: (entry: ProjectFileSearchEntry) => void;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  onReloadMcpServers?: () => void;
  onRefreshFileTreeDirectory?: (directoryPath: string | null) => void;
  onRefreshGitStatus?: () => void;
  onRefreshProject?: () => unknown;
  onCommitChanges?: () => void;
  onClose?: () => void;
  onTerminateBackgroundTerminal?: (terminalId: string) => Promise<void>;
  onTabChange?: (tab: WorkbenchInspectorTab) => void;
  projectName: string;
  projectId?: string;
  projectOpenApps?: readonly ProjectOpenApp[];
  projectOpenPending?: boolean;
  projectPath: string;
  projectRefreshing?: boolean;
  skills?: readonly AgentSkill[];
  subagents?: readonly SubagentContextEntry[];
  tab?: WorkbenchInspectorTab;
  task?: Pick<AgentTaskSnapshot, "turns"> & Partial<Pick<AgentTaskSnapshot, "plan">>;
  taskId?: string;
  terminatingTerminalId?: string | null;
}>;

export type { WorkbenchInspectorTab } from "./workbench-inspector-tabs.js";

export function WorkbenchInspector({
  backgroundTerminals = [],
  backgroundTerminalsError = null,
  backgroundTerminalsPending = false,
  contextOnly = false,
  expandedFileTreePaths = emptyExpandedFileTreePaths,
  fileTreeDirectories = [],
  gitStatus,
  gitStatusDetails,
  gitStatusDetailsError = null,
  gitStatusDetailsPending = false,
  gitStatusError = null,
  gitStatusPending = false,
  gitStatusRefreshing = false,
  gitClient,
  mcpServers = [],
  mcpServersError = null,
  mcpServersPending = false,
  mcpServersRetryAvailable = true,
  mcpServersRefreshing = false,
  mcpServersRetrying = false,
  onFileTreeExpandedChange = () => undefined,
  onOpenFileDiff = () => undefined,
  onOpenTaskAttachment = () => undefined,
  onOpenProjectPath = () => undefined,
  onOpenProjectFile = () => undefined,
  onReferenceProjectPath = () => undefined,
  onOpenSubagent = () => undefined,
  onReloadMcpServers = () => undefined,
  onRefreshFileTreeDirectory = () => undefined,
  onRefreshGitStatus = () => undefined,
  onRefreshProject = () => undefined,
  onCommitChanges = () => undefined,
  onClose,
  onTerminateBackgroundTerminal = () => Promise.resolve(),
  onTabChange = () => undefined,
  projectId,
  projectName,
  projectOpenApps = [],
  projectOpenPending = false,
  projectPath,
  projectRefreshing = false,
  skills = [],
  subagents = [],
  tab = "project",
  task,
  taskId,
  terminatingTerminalId = null,
}: WorkbenchInspectorProps) {
  useTranslation("conversation");
  const availableTabs = getAvailableWorkbenchInspectorTabs(taskId, gitStatus);
  const { activeTab } = deriveWorkbenchInspectorActivation({
    contextOnly,
    gitStatus,
    inspectorOpen: true,
    requestedTab: tab,
    taskId,
  });
  const { changeStats, displayChanges, fileChangesByPath } = useMemo(
    () =>
      activeTab === "context" || activeTab === "project"
        ? deriveInspectorGitChangeState(gitStatus, gitStatusDetails)
        : {
            changeStats: undefined,
            displayChanges: [],
            fileChangesByPath: emptyFileChangesByPath,
          },
    [activeTab, gitStatus, gitStatusDetails],
  );
  const [selectedTreePath, setSelectedTreePath] = useState<string>();
  const [projectRootExpanded, setProjectRootExpanded] = useState(true);
  const fileTreeDirectoryStates = useMemo<Map<string | null, ProjectFileTreeDirectoryState>>(
    () =>
      activeTab === "project"
        ? new Map(fileTreeDirectories.map((state) => [state.path, state]))
        : new Map<string | null, ProjectFileTreeDirectoryState>(),
    [activeTab, fileTreeDirectories],
  );
  const rootFileTreeState = fileTreeDirectoryStates.get(null);
  const projectFileName = getProjectFileName(projectPath);
  const projectRootName = projectFileName === "" ? projectName : projectFileName;
  const visibleExpandedFileTreePaths = useMemo(() => {
    if (activeTab !== "project") return emptyExpandedFileTreePaths;
    const paths = new Set(expandedFileTreePaths);
    if (projectRootExpanded) {
      paths.add(projectPath);
    }
    return paths;
  }, [activeTab, expandedFileTreePaths, projectPath, projectRootExpanded]);
  const filePaths = useMemo(
    () =>
      activeTab === "project"
        ? new Set(
            fileTreeDirectories.flatMap(
              (state) =>
                state.data?.entries
                  .filter((entry) => entry.type === "file")
                  .map((entry) => entry.path) ?? [],
            ),
          )
        : new Set<string>(),
    [activeTab, fileTreeDirectories],
  );
  const isGitProject = gitStatus !== undefined && gitStatus.repositoryMode !== "none";
  const contextContent = (
    <div className="h-full space-y-5 overflow-y-auto p-2.5">
      {isGitProject && displayChanges.length > 0 ? (
        <InspectorGitChangesSection
          changeCount={displayChanges.length}
          changeStats={changeStats}
          onCommitChanges={onCommitChanges}
        />
      ) : null}
      {backgroundTerminals.length > 0 ||
      backgroundTerminalsPending ||
      backgroundTerminalsError !== null ? (
        <BackgroundTerminalSection
          error={backgroundTerminalsError}
          isPending={backgroundTerminalsPending}
          onTerminate={onTerminateBackgroundTerminal}
          terminals={backgroundTerminals}
          terminatingTerminalId={terminatingTerminalId}
        />
      ) : null}
      {subagents.length > 0 ? (
        <SubagentSection onOpenSubagent={onOpenSubagent} subagents={subagents} />
      ) : null}
      <McpServerSection
        canRetry={mcpServersRetryAvailable}
        error={mcpServersError}
        isPending={mcpServersPending}
        isRefreshing={mcpServersRefreshing}
        isRetrying={mcpServersRetrying}
        onRetry={onReloadMcpServers}
        servers={mcpServers}
      />
      <InspectorSources
        onOpenAttachment={onOpenTaskAttachment}
        {...(projectId === undefined ? {} : { projectId })}
        projectName={projectName}
        projectPath={projectPath}
        skills={skills}
        {...(taskId === undefined ? {} : { taskId })}
        turns={task?.turns ?? []}
      />
      {task?.plan === null || task?.plan === undefined ? null : <PlanSection plan={task.plan} />}
    </div>
  );
  return (
    <aside
      aria-label={i18n.t("inspector.title", { ns: "conversation" })}
      className={`workbench-inspector relative z-30 grid min-h-0 bg-panel shadow-divider-reverse ${
        contextOnly ? "grid-rows-[minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]"
      }`}
    >
      <WorkbenchInspectorHeader
        activeTab={activeTab}
        availableTabs={availableTabs}
        contextOnly={contextOnly}
        onClose={onClose}
        onTabChange={onTabChange}
      />

      <div className="min-h-0 overflow-hidden" role={contextOnly ? undefined : "tabpanel"}>
        {activeTab === "project" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              {gitStatusError !== null ? (
                <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-control bg-control px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-diff-removed">
                      {i18n.t("inspector.gitChangesRetrying", { ns: "conversation" })}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={i18n.t("inspector.refreshGit", { ns: "conversation" })}
                        disabled={gitStatusRefreshing}
                        onClick={onRefreshGitStatus}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className={`size-3.5 ${gitStatusRefreshing ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {i18n.t("inspector.refreshGit", { ns: "conversation" })}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : gitStatusPending && gitStatus === undefined ? (
                <p className="mb-2 px-4 text-caption text-muted-foreground">
                  {i18n.t("inspector.gitLoading", { ns: "conversation" })}
                </p>
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
                {rootFileTreeState?.error !== null && rootFileTreeState?.error !== undefined ? (
                  <div className="flex flex-col items-center px-2 py-5 text-center">
                    <p className="text-label text-diff-removed">
                      {i18n.t("inspector.projectFilesError", { ns: "conversation" })}
                    </p>
                    <Button
                      variant="ghost"
                      aria-label={i18n.t("inspector.refreshProjectFiles", {
                        ns: "conversation",
                      })}
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-control bg-control px-3 text-label font-medium text-foreground transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={rootFileTreeState.isFetching}
                      onClick={() => {
                        onRefreshFileTreeDirectory(null);
                      }}
                      type="button"
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={`size-3.5 ${rootFileTreeState.isFetching ? "animate-spin" : ""}`}
                      />
                      {rootFileTreeState.isFetching
                        ? i18n.t("inspector.reading", { ns: "conversation" })
                        : i18n.t("inspector.refreshProjectFiles", { ns: "conversation" })}
                    </Button>
                  </div>
                ) : rootFileTreeState?.isPending === true &&
                  rootFileTreeState.data === undefined ? (
                  <p className="px-2 py-5 text-center text-label text-muted-foreground">
                    {i18n.t("inspector.projectFilesLoading", { ns: "conversation" })}
                  </p>
                ) : (rootFileTreeState?.data?.entries.length ?? 0) === 0 ? (
                  <p className="px-2 py-5 text-center text-label text-muted-foreground">
                    {i18n.t("inspector.projectFilesEmpty", { ns: "conversation" })}
                  </p>
                ) : (
                  <FileTree
                    aria-label={i18n.t("inspector.fileTree", { ns: "conversation" })}
                    expanded={visibleExpandedFileTreePaths}
                    onExpandedChange={(nextExpandedPaths) => {
                      // 项目根节点仅用于界面分组，不能进入后端的相对目录查询集合。
                      setProjectRootExpanded(nextExpandedPaths.has(projectPath));
                      const directoryPaths = new Set(nextExpandedPaths);
                      directoryPaths.delete(projectPath);
                      onFileTreeExpandedChange(directoryPaths);
                    }}
                    onSelect={(path) => {
                      if (path === projectPath) {
                        return;
                      }
                      if (!filePaths.has(path)) {
                        return;
                      }
                      setSelectedTreePath(path);
                      const fileChange = fileChangesByPath.get(path);
                      if (fileChange === undefined) {
                        onOpenProjectFile(path);
                      } else {
                        onOpenFileDiff(fileChange);
                      }
                    }}
                    {...(selectedTreePath === undefined ? {} : { selectedPath: selectedTreePath })}
                  >
                    <ProjectOpenContextMenu
                      apps={projectOpenApps}
                      isPending={projectOpenPending}
                      onOpen={() => {
                        setSelectedTreePath(projectPath);
                      }}
                      onReference={onReferenceProjectPath}
                      onSelect={(appId) => {
                        onOpenProjectPath(appId);
                      }}
                      target={{
                        absolutePath: projectPath,
                        path: projectPath,
                        relativePath: ".",
                        type: "directory",
                      }}
                    >
                      <FileTreeFolder
                        name={projectRootName}
                        path={projectPath}
                        trailing={
                          <ProjectFileTreeRootActions
                            onMenuOpen={() => {
                              setSelectedTreePath(projectPath);
                            }}
                            onOpenProjectPath={(appId) => {
                              onOpenProjectPath(appId);
                            }}
                            onReferenceProjectPath={onReferenceProjectPath}
                            onRefreshProject={onRefreshProject}
                            projectName={projectRootName}
                            projectOpenApps={projectOpenApps}
                            projectOpenPending={projectOpenPending}
                            projectPath={projectPath}
                            refreshing={projectRefreshing}
                          />
                        }
                      >
                        <ProjectFileTreeNodes
                          directoryStates={fileTreeDirectoryStates}
                          entries={rootFileTreeState?.data?.entries ?? []}
                          onContextMenuOpen={(path) => {
                            // 右键目标先进入文件树选中态，让菜单与当前操作对象保持一致。
                            setSelectedTreePath(path);
                          }}
                          onOpenProjectPath={onOpenProjectPath}
                          onReferenceProjectPath={onReferenceProjectPath}
                          onRefreshDirectory={onRefreshFileTreeDirectory}
                          projectOpenApps={projectOpenApps}
                          projectOpenPending={projectOpenPending}
                          projectPath={projectPath}
                        />
                      </FileTreeFolder>
                    </ProjectOpenContextMenu>
                  </FileTree>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === "changes" ? (
          <Suspense fallback={null}>
            <LazyWorkbenchInspectorChanges
              client={gitClient}
              detailsError={gitStatusDetailsError}
              detailsPending={gitStatusDetailsPending}
              detailsStatus={gitStatusDetails}
              gitStatus={gitStatus}
              gitStatusError={gitStatusError}
              onOpenFileDiff={onOpenFileDiff}
              projectId={projectId}
            />
          </Suspense>
        ) : activeTab === "history" && projectId !== undefined ? (
          <Suspense fallback={null}>
            <LazyGitHistoryPanel
              {...(gitClient === undefined ? {} : { client: gitClient })}
              projectId={projectId}
            />
          </Suspense>
        ) : (
          contextContent
        )}
      </div>
    </aside>
  );
}
