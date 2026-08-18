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
import { Braces, FolderTree, PanelRightClose, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

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

export type { ProjectFileTreeDirectoryState } from "./workbench-inspector-file-tree.js";

const emptyExpandedFileTreePaths = new Set<string>();

type WorkbenchInspectorProps = Readonly<{
  backgroundTerminals?: readonly AgentBackgroundTerminal[];
  backgroundTerminalsError?: Error | null;
  backgroundTerminalsPending?: boolean;
  contextOnly?: boolean;
  expandedFileTreePaths?: Set<string>;
  fileTreeDirectories?: readonly ProjectFileTreeDirectoryState[];
  gitStatus?: ProjectGitStatus;
  gitStatusDetails?: ProjectGitStatus | undefined;
  gitStatusError?: Error | null;
  gitStatusPending?: boolean;
  gitStatusRefreshing?: boolean;
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

export type WorkbenchInspectorTab = "changes" | "context";

const projectInspectorTabs = ["changes"] as const;
const taskInspectorTabs = ["changes", "context"] as const;

export function WorkbenchInspector({
  backgroundTerminals = [],
  backgroundTerminalsError = null,
  backgroundTerminalsPending = false,
  contextOnly = false,
  expandedFileTreePaths = emptyExpandedFileTreePaths,
  fileTreeDirectories = [],
  gitStatus,
  gitStatusDetails,
  gitStatusError = null,
  gitStatusPending = false,
  gitStatusRefreshing = false,
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
  tab = "changes",
  task,
  taskId,
  terminatingTerminalId = null,
}: WorkbenchInspectorProps) {
  useTranslation("conversation");
  const { allChanges, changeStats, fileChangesByPath } = useMemo(
    () => deriveInspectorGitChangeState(gitStatus, gitStatusDetails),
    [gitStatus, gitStatusDetails],
  );
  const [selectedTreePath, setSelectedTreePath] = useState<string>();
  const [projectRootExpanded, setProjectRootExpanded] = useState(true);
  const fileTreeDirectoryStates = useMemo(
    () => new Map(fileTreeDirectories.map((state) => [state.path, state])),
    [fileTreeDirectories],
  );
  const rootFileTreeState = fileTreeDirectoryStates.get(null);
  const projectFileName = getProjectFileName(projectPath);
  const projectRootName = projectFileName === "" ? projectName : projectFileName;
  const visibleExpandedFileTreePaths = useMemo(() => {
    const paths = new Set(expandedFileTreePaths);
    if (projectRootExpanded) {
      paths.add(projectPath);
    }
    return paths;
  }, [expandedFileTreePaths, projectPath, projectRootExpanded]);
  const filePaths = useMemo(
    () =>
      new Set(
        fileTreeDirectories.flatMap(
          (state) =>
            state.data?.entries
              .filter((entry) => entry.type === "file")
              .map((entry) => entry.path) ?? [],
        ),
      ),
    [fileTreeDirectories],
  );
  const availableTabs = taskId === undefined ? projectInspectorTabs : taskInspectorTabs;
  // 新建 Task 尚无持久化上下文，路由切换时将失效的上下文选择收敛回项目页。
  const activeTab = contextOnly
    ? "context"
    : tab === "context" && taskId !== undefined
      ? "context"
      : "changes";
  const closeButton =
    onClose === undefined ? null : (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={i18n.t("shell.closeInspector", { ns: "workbench" })}
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PanelRightClose aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{i18n.t("shell.closeInspector", { ns: "workbench" })}</TooltipContent>
      </Tooltip>
    );
  const contextContent = (
    <div className="h-full space-y-5 overflow-y-auto p-2.5">
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
      {contextOnly ? (
        <div className="absolute right-2 top-2 z-10 min-[1101px]:hidden">{closeButton}</div>
      ) : (
        <div className="flex min-h-workbench-header items-center gap-2 px-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
            {availableTabs.map((value) => (
              <Button
                aria-selected={activeTab === value}
                className={`rounded-surface ${
                  activeTab === value ? "bg-control-hover text-foreground" : ""
                }`}
                key={value}
                onClick={() => {
                  onTabChange(value);
                }}
                role="tab"
                size="compact"
                type="button"
                variant="ghost"
              >
                {value === "changes" ? (
                  <FolderTree aria-hidden="true" />
                ) : (
                  <Braces aria-hidden="true" />
                )}
                <span>
                  {value === "changes"
                    ? i18n.t("inspector.changes", { ns: "conversation" })
                    : i18n.t("inspector.context", { ns: "conversation" })}
                </span>
              </Button>
            ))}
          </div>
          <div className="shrink-0 min-[1101px]:hidden">{closeButton}</div>
        </div>
      )}

      <div className="min-h-0 overflow-hidden" role={contextOnly ? undefined : "tabpanel"}>
        {activeTab === "changes" ? (
          <div className="flex h-full min-h-0 flex-col">
            {/* 工作区干净时省略整个摘要模块，把空间完整留给项目文件。 */}
            {allChanges.length > 0 ? (
              <div
                aria-label={i18n.t("inspector.gitChangesAria", { ns: "conversation" })}
                className="flex w-full items-center justify-between gap-2 px-2.5 pb-3 pt-2.5"
                role="group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    {i18n.t("inspector.gitChanges", { ns: "conversation" })}
                  </p>
                  <p
                    aria-label={i18n.t("inspector.changeStats", { ns: "conversation" })}
                    className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground"
                  >
                    <span>
                      {i18n.t("inspector.gitChangesCount", {
                        count: allChanges.length,
                        ns: "conversation",
                      })}
                    </span>
                    {changeStats === undefined ? null : (
                      <>
                        <span className="font-medium text-diff-added">
                          +{changeStats.additions}
                        </span>
                        <span className="font-medium text-diff-removed">
                          -{changeStats.removals}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div
                  aria-label={i18n.t("inspector.changeActions", { ns: "conversation" })}
                  className="flex shrink-0 items-center justify-end gap-1.5"
                  role="group"
                >
                  <Button
                    variant="ghost"
                    aria-haspopup="dialog"
                    aria-label={i18n.t("inspector.commitChanges", {
                      count: allChanges.length,
                      ns: "conversation",
                    })}
                    className="h-7 shrink-0 rounded-control bg-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control"
                    id="workbench-commit-changes"
                    onClick={onCommitChanges}
                    type="button"
                  >
                    {i18n.t("inspector.commit", { ns: "conversation" })}
                  </Button>
                </div>
              </div>
            ) : null}
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
                      target={{ copyPath: projectPath, path: projectPath, type: "directory" }}
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
        ) : (
          contextContent
        )}
      </div>
    </aside>
  );
}
