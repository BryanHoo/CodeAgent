import type {
  AgentBackgroundTerminal,
  AgentMcpServer,
  AgentSkill,
  AgentTurn,
  ProjectFileTree,
  ProjectFileTreeEntry,
  ProjectGitStatus,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import {
  Bot,
  FolderRoot,
  LoaderCircle,
  Paperclip,
  Plug,
  RefreshCw,
  Sparkles,
  Square,
  SquareTerminal,
} from "lucide-react";
import { useMemo, useState } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { countFileChangeLines, type AgentFileChange } from "../../diff/file-change.js";
import { FileTree, FileTreeFile, FileTreeFolder } from "../../../shared/ai-elements/file-tree.js";
import { Task, TaskTrigger } from "../../../shared/ai-elements/task.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import { ProjectOpenContextMenu, type ProjectOpenContextMenuTarget } from "./project-open-menu.js";
import {
  formatSubagentModel,
  toSubagentTaskStatus,
  type SubagentContextEntry,
  type SubagentSelection,
} from "./subagent.js";

type WorkbenchInspectorProps = Readonly<{
  backgroundTerminals?: readonly AgentBackgroundTerminal[];
  backgroundTerminalsError?: Error | null;
  backgroundTerminalsPending?: boolean;
  expandedFileTreePaths?: Set<string>;
  fileTreeDirectories?: readonly ProjectFileTreeDirectoryState[];
  gitStatus?: ProjectGitStatus;
  gitStatusError?: Error | null;
  gitStatusPending?: boolean;
  gitStatusRefreshing?: boolean;
  mcpServers?: readonly AgentMcpServer[];
  mcpServersError?: Error | null;
  mcpServersPending?: boolean;
  onFileTreeExpandedChange?: (expandedPaths: Set<string>) => void;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenProjectPath?: (appId: ProjectOpenAppId, path: string) => void;
  onOpenSourceFile?: (path: string) => void;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  onRefreshFileTreeDirectory?: (directoryPath: string | null) => void;
  onRefreshGitStatus?: () => void;
  onCommitChanges?: () => void;
  onReviewChanges?: (changes: readonly AgentFileChange[]) => void;
  onTerminateBackgroundTerminal?: (terminalId: string) => Promise<void>;
  projectName: string;
  projectOpenApps?: readonly ProjectOpenApp[];
  projectOpenError?: Error | null;
  projectOpenPending?: boolean;
  projectPath: string;
  skills?: readonly AgentSkill[];
  subagents?: readonly SubagentContextEntry[];
  task?: Readonly<{ turns: readonly AgentTurn[] }>;
  terminalMutationError?: Error | null;
  terminatingTerminalId?: string | null;
}>;

export type ProjectFileTreeDirectoryState = Readonly<{
  data?: ProjectFileTree;
  error: Error | null;
  isFetching: boolean;
  isPending: boolean;
  path: string | null;
}>;

const emptyExpandedFileTreePaths = new Set<string>();

type InspectorSource = Readonly<{
  detail: string;
  id: string;
  kind: "attachment" | "project" | "skill";
  name: string;
}>;

function getProjectFileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

type ProjectFileTreeNodesProps = Readonly<{
  changeStatsByPath: ReadonlyMap<string, FileTreeChangeStats>;
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>;
  entries: readonly ProjectFileTreeEntry[];
  expandedPaths: ReadonlySet<string>;
  onOpenContextMenu: (target: ProjectOpenContextMenuTarget) => void;
  onRefreshDirectory: (directoryPath: string | null) => void;
}>;

type FileTreeChangeStats = Readonly<{
  additions: number;
  changes: number;
  removals: number;
}>;

function addFileTreeChangeStats(
  statsByPath: Map<string, FileTreeChangeStats>,
  path: string,
  additions: number,
  removals: number,
  changes = 1,
) {
  const current = statsByPath.get(path);
  statsByPath.set(path, {
    additions: (current?.additions ?? 0) + additions,
    changes: (current?.changes ?? 0) + changes,
    removals: (current?.removals ?? 0) + removals,
  });
}

function collectFileTreeChangeSummary(changes: readonly AgentFileChange[]): Readonly<{
  additions: number;
  changesByPath: ReadonlyMap<string, AgentFileChange>;
  removals: number;
  statsByPath: ReadonlyMap<string, FileTreeChangeStats>;
}> {
  const changesByPath = new Map<string, AgentFileChange>();
  const statsByPath = new Map<string, FileTreeChangeStats>();
  let totalAdditions = 0;
  let totalRemovals = 0;

  for (const change of changes) {
    const { additions, removals } = countFileChangeLines(change);
    if (!changesByPath.has(change.path)) {
      changesByPath.set(change.path, change);
    }
    totalAdditions += additions;
    totalRemovals += removals;
    addFileTreeChangeStats(statsByPath, change.path, additions, removals);

    // 同一路径可能同时存在暂存和未暂存变更，逐层累计后只需按节点路径读取一次。
    const pathSegments = change.path.split("/");
    for (let segmentIndex = 1; segmentIndex < pathSegments.length; segmentIndex += 1) {
      addFileTreeChangeStats(
        statsByPath,
        pathSegments.slice(0, segmentIndex).join("/"),
        additions,
        removals,
      );
    }
  }

  return { additions: totalAdditions, changesByPath, removals: totalRemovals, statsByPath };
}

function getFileTreeNodeChangeStats(
  entry: ProjectFileTreeEntry,
  changeStatsByPath: ReadonlyMap<string, FileTreeChangeStats>,
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>,
  expandedPaths: ReadonlySet<string>,
): FileTreeChangeStats | undefined {
  const aggregateStats = changeStatsByPath.get(entry.path);
  if (aggregateStats === undefined || entry.type === "file" || !expandedPaths.has(entry.path)) {
    return aggregateStats;
  }

  const directoryState = directoryStates.get(entry.path);
  if (directoryState?.error !== null && directoryState?.error !== undefined) {
    return aggregateStats;
  }
  const childEntries = directoryState?.data?.entries;
  if (childEntries === undefined) {
    return aggregateStats;
  }

  let delegatedAdditions = 0;
  let delegatedChanges = 0;
  let delegatedRemovals = 0;
  for (const childEntry of childEntries) {
    const childStats = changeStatsByPath.get(childEntry.path);
    delegatedAdditions += childStats?.additions ?? 0;
    delegatedChanges += childStats?.changes ?? 0;
    delegatedRemovals += childStats?.removals ?? 0;
  }

  // 删除或被过滤的文件没有树节点，未被子节点承接的统计继续保留在当前目录。
  const remainingChanges = aggregateStats.changes - delegatedChanges;
  return remainingChanges > 0
    ? {
        additions: Math.max(0, aggregateStats.additions - delegatedAdditions),
        changes: remainingChanges,
        removals: Math.max(0, aggregateStats.removals - delegatedRemovals),
      }
    : undefined;
}

function FileTreeChangeIndicator({
  isDirectory,
  path,
  stats,
}: Readonly<{
  isDirectory: boolean;
  path: string;
  stats: FileTreeChangeStats;
}>) {
  return (
    <span
      aria-label={i18n.t("inspector.changeIndicator", {
        additions: stats.additions,
        descendant: isDirectory ? i18n.t("inspector.descendant", { ns: "conversation" }) : "",
        ns: "conversation",
        path,
        removals: stats.removals,
      })}
      className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-meta"
    >
      <span className="font-medium text-diff-added">+{stats.additions}</span>
      <span className="font-medium text-diff-removed">-{stats.removals}</span>
    </span>
  );
}

function ProjectFileTreeDirectoryChildren({
  changeStatsByPath,
  directoryPath,
  directoryStates,
  expandedPaths,
  onOpenContextMenu,
  onRefreshDirectory,
}: Readonly<{
  changeStatsByPath: ReadonlyMap<string, FileTreeChangeStats>;
  directoryPath: string;
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>;
  expandedPaths: ReadonlySet<string>;
  onOpenContextMenu: (target: ProjectOpenContextMenuTarget) => void;
  onRefreshDirectory: (directoryPath: string | null) => void;
}>) {
  const state = directoryStates.get(directoryPath);
  const name = getProjectFileName(directoryPath);
  if (state?.error !== null && state?.error !== undefined) {
    return (
      <div
        aria-selected="false"
        className="flex min-h-7 items-center gap-2 px-1.5 text-caption text-diff-removed"
        role="treeitem"
      >
        <span className="min-w-0 flex-1 truncate">
          {i18n.t("inspector.readFolderError", { name, ns: "conversation" })}
        </span>
        <IconButton
          label={i18n.t("inspector.refreshFolder", { name, ns: "conversation" })}
          onClick={() => {
            onRefreshDirectory(directoryPath);
          }}
          size="small"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
        </IconButton>
      </div>
    );
  }
  if (state === undefined || (state.isPending && state.data === undefined)) {
    return (
      <div
        aria-label={i18n.t("inspector.readFolder", { name, ns: "conversation" })}
        aria-selected="false"
        className="flex min-h-7 items-center gap-1.5 px-1.5 text-caption text-muted-foreground"
        role="treeitem"
      >
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        <span>{i18n.t("inspector.loading", { ns: "conversation" })}</span>
      </div>
    );
  }
  if (state.data?.entries.length === 0) {
    return (
      <div
        aria-selected="false"
        className="min-h-7 px-1.5 py-1.5 text-caption text-muted-foreground"
        role="treeitem"
      >
        {i18n.t("inspector.emptyFolder", { ns: "conversation" })}
      </div>
    );
  }
  return (
    <ProjectFileTreeNodes
      changeStatsByPath={changeStatsByPath}
      directoryStates={directoryStates}
      entries={state.data?.entries ?? []}
      expandedPaths={expandedPaths}
      onOpenContextMenu={onOpenContextMenu}
      onRefreshDirectory={onRefreshDirectory}
    />
  );
}

function ProjectFileTreeNodes({
  changeStatsByPath,
  directoryStates,
  entries,
  expandedPaths,
  onOpenContextMenu,
  onRefreshDirectory,
}: ProjectFileTreeNodesProps) {
  return entries.map((entry) => {
    const name = getProjectFileName(entry.path);
    const changeStats = getFileTreeNodeChangeStats(
      entry,
      changeStatsByPath,
      directoryStates,
      expandedPaths,
    );
    const trailing =
      changeStats === undefined ? undefined : (
        <FileTreeChangeIndicator
          isDirectory={entry.type === "directory"}
          path={entry.path}
          stats={changeStats}
        />
      );
    return entry.type === "directory" ? (
      <FileTreeFolder
        key={entry.path}
        name={name}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu({
            path: entry.path,
            pointerX: event.clientX,
            pointerY: event.clientY,
          });
        }}
        path={entry.path}
        trailing={trailing}
      >
        <ProjectFileTreeDirectoryChildren
          changeStatsByPath={changeStatsByPath}
          directoryPath={entry.path}
          directoryStates={directoryStates}
          expandedPaths={expandedPaths}
          onOpenContextMenu={onOpenContextMenu}
          onRefreshDirectory={onRefreshDirectory}
        />
      </FileTreeFolder>
    ) : (
      <FileTreeFile
        key={entry.path}
        name={name}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu({
            path: entry.path,
            pointerX: event.clientX,
            pointerY: event.clientY,
          });
        }}
        path={entry.path}
        trailing={trailing}
      />
    );
  });
}

function collectInspectorSources(
  projectName: string,
  projectPath: string,
  turns: readonly AgentTurn[],
  skills: readonly AgentSkill[],
): InspectorSource[] {
  const sources: InspectorSource[] = [
    { detail: projectPath, id: `project:${projectPath}`, kind: "project", name: projectName },
  ];
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const seenSkills = new Set<string>();
  const seenAttachments = new Set<string>();

  // 同一来源可能在多个 Turn 中重复出现，Inspector 只保留首次使用位置的稳定条目。
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "message" || item.role !== "user") {
        continue;
      }
      for (const skillReference of item.skills ?? []) {
        if (seenSkills.has(skillReference.name)) {
          continue;
        }
        seenSkills.add(skillReference.name);
        const skill = skillsByName.get(skillReference.name);
        sources.push({
          detail: skill === undefined ? "Skill" : `Skill · ${formatSkillScope(skill.scope)}`,
          id: `skill:${skillReference.name}`,
          kind: "skill",
          name: skill?.displayName ?? skillReference.name,
        });
      }
      for (const attachment of item.attachments ?? []) {
        if (seenAttachments.has(attachment.id)) {
          continue;
        }
        seenAttachments.add(attachment.id);
        sources.push({
          detail: i18n.t("inspector.attachmentDetail", { ns: "conversation" }),
          id: `attachment:${attachment.id}`,
          kind: "attachment",
          name: attachment.name,
        });
      }
    }
  }
  return sources;
}

function formatSkillScope(scope: AgentSkill["scope"]) {
  const labels: Readonly<Record<AgentSkill["scope"], string>> = {
    admin: i18n.t("inspector.sourceRole.admin", { ns: "conversation" }),
    repo: i18n.t("inspector.sourceRole.repo", { ns: "conversation" }),
    system: i18n.t("inspector.sourceRole.system", { ns: "conversation" }),
    user: i18n.t("inspector.sourceRole.user", { ns: "conversation" }),
  };
  return labels[scope];
}

export function WorkbenchInspector({
  backgroundTerminals = [],
  backgroundTerminalsError = null,
  backgroundTerminalsPending = false,
  expandedFileTreePaths = emptyExpandedFileTreePaths,
  fileTreeDirectories = [],
  gitStatus,
  gitStatusError = null,
  gitStatusPending = false,
  gitStatusRefreshing = false,
  mcpServers = [],
  mcpServersError = null,
  mcpServersPending = false,
  onFileTreeExpandedChange = () => undefined,
  onOpenFileDiff = () => undefined,
  onOpenProjectPath = () => undefined,
  onOpenSourceFile = () => undefined,
  onOpenSubagent = () => undefined,
  onRefreshFileTreeDirectory = () => undefined,
  onRefreshGitStatus = () => undefined,
  onCommitChanges = () => undefined,
  onReviewChanges = () => undefined,
  onTerminateBackgroundTerminal = () => Promise.resolve(),
  projectName,
  projectOpenApps = [],
  projectOpenError = null,
  projectOpenPending = false,
  projectPath,
  skills = [],
  subagents = [],
  task,
  terminalMutationError = null,
  terminatingTerminalId = null,
}: WorkbenchInspectorProps) {
  useTranslation("conversation");
  const [tab, setTab] = useState<"changes" | "context">(() =>
    subagents.length > 0 || backgroundTerminals.length > 0 ? "context" : "changes",
  );
  const changeSummary = useMemo(() => {
    const changes = [...(gitStatus?.unstaged ?? []), ...(gitStatus?.staged ?? [])];
    return { changes, ...collectFileTreeChangeSummary(changes) };
  }, [gitStatus]);
  const allChanges = changeSummary.changes;
  const fileChangesByPath = changeSummary.changesByPath;
  const fileTreeChangeStats = changeSummary.statsByPath;
  const [selectedTreePath, setSelectedTreePath] = useState<string>();
  const [projectOpenTarget, setProjectOpenTarget] = useState<ProjectOpenContextMenuTarget | null>(
    null,
  );
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
  return (
    <aside
      aria-label={i18n.t("inspector.title", { ns: "conversation" })}
      className="workbench-inspector relative z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-panel shadow-divider-reverse"
    >
      <div className="flex h-workbench-header items-center px-3">
        <h2 className="text-body-small font-semibold text-foreground">
          {i18n.t("inspector.title", { ns: "conversation" })}
        </h2>
      </div>

      <div className="px-2.5 pb-1.5">
        <div className="grid grid-cols-2 rounded-control bg-control p-0.5" role="tablist">
          {(["changes", "context"] as const).map((value) => (
            <button
              aria-selected={tab === value}
              className={`h-7 rounded-control text-label font-medium transition-colors ${
                tab === value
                  ? "bg-raised text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={value}
              onClick={() => {
                setTab(value);
              }}
              role="tab"
              type="button"
            >
              {value === "changes"
                ? i18n.t("inspector.changes", { ns: "conversation" })
                : i18n.t("inspector.context", { ns: "conversation" })}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden" role="tabpanel">
        {tab === "changes" ? (
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
                  <button
                    aria-haspopup="dialog"
                    aria-label={i18n.t("inspector.reviewChanges", {
                      count: allChanges.length,
                      ns: "conversation",
                    })}
                    className="h-7 shrink-0 rounded-control bg-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none"
                    onClick={() => {
                      onReviewChanges(allChanges);
                    }}
                    type="button"
                  >
                    {i18n.t("inspector.review", { ns: "conversation" })}
                  </button>
                  <button
                    aria-haspopup="dialog"
                    aria-label={i18n.t("inspector.commitChanges", {
                      count: allChanges.length,
                      ns: "conversation",
                    })}
                    className="h-7 shrink-0 rounded-control bg-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control"
                    disabled={gitStatus?.repositoryMode === "children"}
                    id="workbench-commit-changes"
                    onClick={onCommitChanges}
                    type="button"
                  >
                    {i18n.t("inspector.commit", { ns: "conversation" })}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col">
              {gitStatusError !== null ? (
                <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-control bg-control px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-diff-removed">
                      {i18n.t("inspector.gitChangesStopped", { ns: "conversation" })}
                    </p>
                  </div>
                  <IconButton
                    disabled={gitStatusRefreshing}
                    label={i18n.t("inspector.refreshGit", { ns: "conversation" })}
                    onClick={onRefreshGitStatus}
                    size="small"
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={`size-3.5 ${gitStatusRefreshing ? "animate-spin" : ""}`}
                    />
                  </IconButton>
                </div>
              ) : gitStatusPending && gitStatus === undefined ? (
                <p className="mb-2 px-4 text-caption text-muted-foreground">
                  {i18n.t("inspector.gitLoading", { ns: "conversation" })}
                </p>
              ) : null}
              {/* 标题固定在文件树滚动容器外，滚动长目录时始终保持可见。 */}
              <div className="mb-1 flex shrink-0 items-center justify-between px-4 text-meta font-medium text-muted-foreground">
                <span>{i18n.t("inspector.fileTree", { ns: "conversation" })}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
                {rootFileTreeState?.error !== null && rootFileTreeState?.error !== undefined ? (
                  <div className="flex flex-col items-center px-2 py-5 text-center">
                    <p className="text-label text-diff-removed">
                      {i18n.t("inspector.projectFilesError", { ns: "conversation" })}
                    </p>
                    <button
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
                    </button>
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
                    expanded={expandedFileTreePaths}
                    onExpandedChange={onFileTreeExpandedChange}
                    onSelect={(path) => {
                      if (!filePaths.has(path)) {
                        return;
                      }
                      setSelectedTreePath(path);
                      const fileChange = fileChangesByPath.get(path);
                      if (fileChange === undefined) {
                        onOpenSourceFile(path);
                      } else {
                        onOpenFileDiff(fileChange);
                      }
                    }}
                    {...(selectedTreePath === undefined ? {} : { selectedPath: selectedTreePath })}
                  >
                    <ProjectFileTreeNodes
                      changeStatsByPath={fileTreeChangeStats}
                      directoryStates={fileTreeDirectoryStates}
                      entries={rootFileTreeState?.data?.entries ?? []}
                      expandedPaths={expandedFileTreePaths}
                      onOpenContextMenu={(target) => {
                        // 右键目标先进入文件树选中态，让菜单与当前操作对象保持一致。
                        setSelectedTreePath(target.path);
                        if (projectOpenApps.length > 0) {
                          setProjectOpenTarget(target);
                        }
                      }}
                      onRefreshDirectory={onRefreshFileTreeDirectory}
                    />
                  </FileTree>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full space-y-5 overflow-y-auto p-2.5">
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
              error={mcpServersError}
              isPending={mcpServersPending}
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
        )}
      </div>
      {projectOpenTarget === null ? null : (
        <ProjectOpenContextMenu
          apps={projectOpenApps}
          isPending={projectOpenPending}
          onClose={() => {
            setProjectOpenTarget(null);
          }}
          onSelect={onOpenProjectPath}
          target={projectOpenTarget}
        />
      )}
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

function BackgroundTerminalSection({
  error,
  isPending,
  mutationError,
  onTerminate,
  terminals,
  terminatingTerminalId,
}: Readonly<{
  error: Error | null;
  isPending: boolean;
  mutationError: Error | null;
  onTerminate: (terminalId: string) => Promise<void>;
  terminals: readonly AgentBackgroundTerminal[];
  terminatingTerminalId: string | null;
}>) {
  return (
    <InspectorSection
      icon={<SquareTerminal className="size-3.5" />}
      title={i18n.t("inspector.terminals", { ns: "conversation" })}
    >
      <section aria-label={i18n.t("inspector.terminals", { ns: "conversation" })}>
        {isPending && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-muted-foreground">
            {i18n.t("inspector.terminalLoading", { ns: "conversation" })}
          </p>
        ) : error !== null && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-diff-removed">
            {i18n.t("inspector.terminalError", { ns: "conversation" })}
          </p>
        ) : (
          <div className="space-y-1">
            {terminals.map((terminal) => {
              const isTerminating = terminatingTerminalId === terminal.id;
              return (
                <div
                  className="flex items-center gap-1 rounded-control px-2 py-1.5 hover:bg-control-hover"
                  key={terminal.id}
                >
                  <LoaderCircle
                    aria-label={i18n.t("inspector.terminalRunning", { ns: "conversation" })}
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-label font-medium text-foreground"
                      title={terminal.command}
                    >
                      {terminal.command}
                    </p>
                    <p className="truncate text-caption text-muted-foreground" title={terminal.cwd}>
                      {terminal.cwd}
                    </p>
                  </div>
                  <IconButton
                    disabled={terminatingTerminalId !== null}
                    label={
                      isTerminating
                        ? i18n.t("inspector.terminalStopping", {
                            command: terminal.command,
                            ns: "conversation",
                          })
                        : i18n.t("inspector.terminalStop", {
                            command: terminal.command,
                            ns: "conversation",
                          })
                    }
                    onClick={() => void onTerminate(terminal.id)}
                    size="small"
                  >
                    <Square aria-hidden="true" className="size-3" />
                  </IconButton>
                </div>
              );
            })}
          </div>
        )}
        {mutationError === null ? null : (
          <p className="px-2 pt-1 text-caption text-diff-removed" role="alert">
            {i18n.t("inspector.terminalStopRetry", { ns: "conversation" })}
          </p>
        )}
      </section>
    </InspectorSection>
  );
}

function SubagentSection({
  onOpenSubagent,
  subagents,
}: Readonly<{
  onOpenSubagent: (selection: SubagentSelection) => void;
  subagents: readonly SubagentContextEntry[];
}>) {
  return (
    <InspectorSection
      icon={<Bot className="size-3.5" />}
      title={i18n.t("inspector.subagents", { ns: "conversation" })}
    >
      <section aria-label={i18n.t("inspector.subagents", { ns: "conversation" })}>
        <p className="mb-1 px-2 text-caption text-muted-foreground">
          {i18n.t("inspector.subagentCount", {
            count: subagents.length,
            ns: "conversation",
          })}
        </p>
        <div className="space-y-1">
          {subagents.map((subagent) => {
            const metadata = [
              subagent.model === undefined ? undefined : formatSubagentModel(subagent.model),
              subagent.reasoningEffort,
            ].filter((value): value is string => value !== undefined);
            return (
              <button
                aria-haspopup="dialog"
                aria-label={i18n.t("inspector.subagentOutput", {
                  nickname: subagent.nickname,
                  ns: "conversation",
                })}
                className="w-full rounded-control px-2 text-left transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none"
                key={subagent.taskId}
                onClick={() => {
                  onOpenSubagent({ status: subagent.status, taskId: subagent.taskId });
                }}
                type="button"
              >
                <Task collapsible={false} status={toSubagentTaskStatus(subagent.status)}>
                  <TaskTrigger title={subagent.nickname} />
                </Task>
                {metadata.length === 0 ? null : (
                  <p className="pb-2 text-caption text-muted-foreground">{metadata.join(" · ")}</p>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </InspectorSection>
  );
}

function McpServerSection({
  error,
  isPending,
  servers,
}: Readonly<{
  error: Error | null;
  isPending: boolean;
  servers: readonly AgentMcpServer[];
}>) {
  return (
    <InspectorSection icon={<Plug className="size-3.5" />} title="MCP">
      {isPending && servers.length === 0 ? (
        <p className="px-2 py-2 text-caption text-muted-foreground">
          {i18n.t("inspector.mcpLoading", { ns: "conversation" })}
        </p>
      ) : error !== null && servers.length === 0 ? (
        <p className="px-2 py-2 text-caption text-diff-removed">
          {i18n.t("inspector.mcpError", { ns: "conversation" })}
        </p>
      ) : servers.length === 0 ? (
        <p className="px-2 py-2 text-caption text-muted-foreground">
          {i18n.t("inspector.mcpEmpty", { ns: "conversation" })}
        </p>
      ) : (
        <div
          aria-label={i18n.t("inspector.mcpEnabled", { ns: "conversation" })}
          className="space-y-0.5"
        >
          {servers.map((server) => (
            <div
              className="flex min-h-7 items-center rounded-control px-2 text-label font-medium text-foreground"
              key={server.name}
              title={server.name}
            >
              <span className="min-w-0 truncate">{server.name}</span>
            </div>
          ))}
        </div>
      )}
    </InspectorSection>
  );
}

type InspectorSectionProps = Readonly<{
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}>;

function InspectorSection({ children, icon, title }: InspectorSectionProps) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function InspectorSourceRow({ source }: Readonly<{ source: InspectorSource }>) {
  const icon =
    source.kind === "project" ? (
      <FolderRoot aria-hidden="true" className="size-3.5" />
    ) : source.kind === "skill" ? (
      <Sparkles aria-hidden="true" className="size-3.5 text-accent" />
    ) : (
      <Paperclip aria-hidden="true" className="size-3.5" />
    );
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-control px-2 py-1.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-label font-medium text-foreground" title={source.name}>
          {source.name}
        </p>
        {source.kind === "project" ? (
          <p className="truncate text-caption text-muted-foreground" title={source.detail}>
            <span>{i18n.t("inspector.projectDirectory", { ns: "conversation" })}</span>
            <span aria-hidden="true"> · </span>
            <span>{source.detail}</span>
          </p>
        ) : (
          <p className="truncate text-caption text-muted-foreground">{source.detail}</p>
        )}
      </div>
    </div>
  );
}
