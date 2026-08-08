import type {
  AgentBackgroundTerminal,
  AgentMcpServer,
  AgentSkill,
  AgentTaskSnapshot,
  ProjectGitStatus,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import { FolderRoot, PanelRightClose, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import {
  FileTree,
  FileTreeActions,
  FileTreeFolder,
} from "../../../shared/components/agent/file-tree.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import {
  getProjectOpenAppsForTarget,
  ProjectOpenContextMenu,
  ProjectOpenDropdownMenu,
} from "./project-open-menu.js";
import type { SubagentContextEntry, SubagentSelection } from "./subagent.js";

import {
  ProjectFileTreeNodes,
  collectFileTreeChangeSummary,
  getProjectFileName,
  type ProjectFileTreeDirectoryState,
} from "./workbench-inspector-file-tree.js";
import {
  BackgroundTerminalSection,
  InspectorSection,
  InspectorSourceRow,
  McpServerSection,
  SubagentSection,
  collectInspectorSources,
} from "./workbench-inspector-sections.js";
import { PlanSection } from "./workbench-inspector-plan.js";

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
  gitStatusError?: Error | null;
  gitStatusPending?: boolean;
  gitStatusRefreshing?: boolean;
  mcpServers?: readonly AgentMcpServer[];
  mcpServersError?: Error | null;
  mcpServersPending?: boolean;
  mcpServersRetryAvailable?: boolean;
  mcpServersRefreshing?: boolean;
  mcpServersRetryError?: Error | null;
  mcpServersRetrying?: boolean;
  onFileTreeExpandedChange?: (expandedPaths: Set<string>) => void;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenProjectPath?: (appId: ProjectOpenAppId, path?: string) => void;
  onOpenProjectFile?: (path: string) => void;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  onReloadMcpServers?: () => void;
  onRefreshFileTreeDirectory?: (directoryPath: string | null) => void;
  onRefreshGitStatus?: () => void;
  onCommitChanges?: () => void;
  onClose?: () => void;
  onTerminateBackgroundTerminal?: (terminalId: string) => Promise<void>;
  onTabChange?: (tab: WorkbenchInspectorTab) => void;
  projectName: string;
  projectOpenApps?: readonly ProjectOpenApp[];
  projectOpenError?: Error | null;
  projectOpenPending?: boolean;
  projectPath: string;
  skills?: readonly AgentSkill[];
  subagents?: readonly SubagentContextEntry[];
  tab?: WorkbenchInspectorTab;
  task?: Pick<AgentTaskSnapshot, "turns"> & Partial<Pick<AgentTaskSnapshot, "plan">>;
  terminalMutationError?: Error | null;
  terminatingTerminalId?: string | null;
}>;

export type WorkbenchInspectorTab = "changes" | "context";

export function WorkbenchInspector({
  backgroundTerminals = [],
  backgroundTerminalsError = null,
  backgroundTerminalsPending = false,
  contextOnly = false,
  expandedFileTreePaths = emptyExpandedFileTreePaths,
  fileTreeDirectories = [],
  gitStatus,
  gitStatusError = null,
  gitStatusPending = false,
  gitStatusRefreshing = false,
  mcpServers = [],
  mcpServersError = null,
  mcpServersPending = false,
  mcpServersRetryAvailable = true,
  mcpServersRefreshing = false,
  mcpServersRetryError = null,
  mcpServersRetrying = false,
  onFileTreeExpandedChange = () => undefined,
  onOpenFileDiff = () => undefined,
  onOpenProjectPath = () => undefined,
  onOpenProjectFile = () => undefined,
  onOpenSubagent = () => undefined,
  onReloadMcpServers = () => undefined,
  onRefreshFileTreeDirectory = () => undefined,
  onRefreshGitStatus = () => undefined,
  onCommitChanges = () => undefined,
  onClose,
  onTerminateBackgroundTerminal = () => Promise.resolve(),
  onTabChange = () => undefined,
  projectName,
  projectOpenApps = [],
  projectOpenError = null,
  projectOpenPending = false,
  projectPath,
  skills = [],
  subagents = [],
  tab = "changes",
  task,
  terminalMutationError = null,
  terminatingTerminalId = null,
}: WorkbenchInspectorProps) {
  useTranslation("conversation");
  const changeSummary = useMemo(() => {
    const changes = [...(gitStatus?.unstaged ?? []), ...(gitStatus?.staged ?? [])];
    return { changes, ...collectFileTreeChangeSummary(changes) };
  }, [gitStatus]);
  const allChanges = changeSummary.changes;
  const fileChangesByPath = changeSummary.changesByPath;
  const fileTreeChangeStats = changeSummary.statsByPath;
  const [selectedTreePath, setSelectedTreePath] = useState<string>();
  const [projectRootExpanded, setProjectRootExpanded] = useState(true);
  const { additions, removals } = changeSummary;
  const sources = useMemo(
    () => collectInspectorSources(projectName, projectPath, task?.turns ?? [], skills),
    [projectName, projectPath, skills, task?.turns],
  );
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
  const activeTab = contextOnly ? "context" : tab;
  const contextContent = (
    <div className="h-full space-y-5 overflow-y-auto p-2.5">
      {task?.plan === null || task?.plan === undefined ? null : <PlanSection plan={task.plan} />}
      {backgroundTerminals.length > 0 ||
      backgroundTerminalsPending ||
      backgroundTerminalsError !== null ? (
        <BackgroundTerminalSection
          error={backgroundTerminalsError}
          isPending={backgroundTerminalsPending}
          mutationError={terminalMutationError}
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
        retryError={mcpServersRetryError}
        servers={mcpServers}
      />
      <InspectorSection
        icon={<FolderRoot className="size-3.5" />}
        title={i18n.t("inspector.source", { ns: "conversation" })}
      >
        <div
          aria-label={i18n.t("inspector.contextSources", { ns: "conversation" })}
          className="space-y-0.5"
        >
          {sources.map((source) => (
            <InspectorSourceRow key={source.id} source={source} />
          ))}
        </div>
      </InspectorSection>
    </div>
  );
  return (
    <aside
      aria-label={i18n.t("inspector.title", { ns: "conversation" })}
      className={`workbench-inspector relative z-30 grid min-h-0 bg-panel shadow-divider-reverse ${
        contextOnly ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[auto_auto_minmax(0,1fr)]"
      }`}
    >
      <div className="flex h-workbench-header items-center justify-between gap-2 px-3">
        <h2 className="min-w-0 flex-1 truncate text-body-small font-semibold text-foreground">
          {i18n.t("inspector.title", { ns: "conversation" })}
        </h2>
        {onClose === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={i18n.t("shell.closeInspector", { ns: "workbench" })}
                className="min-[1101px]:hidden"
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
        )}
      </div>

      {contextOnly ? null : (
        <div className="px-2.5 pb-1.5">
          <div className="grid grid-cols-2 rounded-control bg-control p-0.5" role="tablist">
            {(["changes", "context"] as const).map((value) => (
              <Button
                variant="ghost"
                aria-selected={activeTab === value}
                className={`h-7 rounded-control text-label font-medium transition-colors ${
                  activeTab === value
                    ? "bg-raised text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                key={value}
                onClick={() => {
                  onTabChange(value);
                }}
                role="tab"
                type="button"
              >
                {value === "changes"
                  ? i18n.t("inspector.changes", { ns: "conversation" })
                  : i18n.t("inspector.context", { ns: "conversation" })}
              </Button>
            ))}
          </div>
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
                    <span className="font-medium text-diff-added">+{additions}</span>
                    <span className="font-medium text-diff-removed">-{removals}</span>
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
                      onSelect={(appId) => {
                        onOpenProjectPath(appId);
                      }}
                      target={{ path: projectPath, type: "directory" }}
                    >
                      <FileTreeFolder
                        name={projectRootName}
                        path={projectPath}
                        trailing={
                          getProjectOpenAppsForTarget(projectOpenApps, "directory").length ===
                          0 ? undefined : (
                            <FileTreeActions>
                              <ProjectOpenDropdownMenu
                                apps={projectOpenApps}
                                isPending={projectOpenPending}
                                onOpen={() => {
                                  setSelectedTreePath(projectPath);
                                }}
                                onSelect={(appId) => {
                                  onOpenProjectPath(appId);
                                }}
                                target={{ path: projectPath, type: "directory" }}
                              />
                            </FileTreeActions>
                          )
                        }
                      >
                        <ProjectFileTreeNodes
                          changeStatsByPath={fileTreeChangeStats}
                          directoryStates={fileTreeDirectoryStates}
                          entries={rootFileTreeState?.data?.entries ?? []}
                          expandedPaths={expandedFileTreePaths}
                          onContextMenuOpen={(path) => {
                            // 右键目标先进入文件树选中态，让菜单与当前操作对象保持一致。
                            setSelectedTreePath(path);
                          }}
                          onOpenProjectPath={onOpenProjectPath}
                          onRefreshDirectory={onRefreshFileTreeDirectory}
                          projectOpenApps={projectOpenApps}
                          projectOpenPending={projectOpenPending}
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
      {projectOpenError === null ? null : (
        <p
          className="absolute bottom-3 right-3 z-40 w-60 rounded-control bg-danger-soft px-2 py-1.5 text-meta text-danger shadow-floating"
          role="alert"
        >
          {i18n.t("inspector.openFailed", { ns: "conversation" })}
        </p>
      )}
    </aside>
  );
}
