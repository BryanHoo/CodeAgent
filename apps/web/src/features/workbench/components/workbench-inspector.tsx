import type {
  AgentBackgroundTerminal,
  AgentSkill,
  AgentTaskSettings,
  AgentTurn,
  ProjectFileTree,
  ProjectFileTreeEntry,
  ProjectGitStatus,
} from "@code-agent/protocol";
import {
  Bot,
  FolderRoot,
  HardDrive,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Sparkles,
  Square,
  SquareTerminal,
} from "lucide-react";
import { useMemo, useState } from "react";

import { countFileChangeLines, type AgentFileChange } from "../../diff/file-change.js";
import { FileTree, FileTreeFile, FileTreeFolder } from "../../../shared/ai-elements/file-tree.js";
import { Task, TaskTrigger } from "../../../shared/ai-elements/task.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
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
  onFileTreeExpandedChange?: (expandedPaths: Set<string>) => void;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenSourceFile?: (path: string) => void;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  onRefreshFileTreeDirectory?: (directoryPath: string | null) => void;
  onRefreshGitStatus?: () => void;
  onReviewChanges?: (changes: readonly AgentFileChange[]) => void;
  onTerminateBackgroundTerminal?: (terminalId: string) => Promise<void>;
  projectName: string;
  projectPath: string;
  settings: AgentTaskSettings;
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
      aria-label={`${path}，${isDirectory ? "后代" : ""}新增 ${String(stats.additions)} 行，删除 ${String(stats.removals)} 行`}
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
  onRefreshDirectory,
}: Readonly<{
  changeStatsByPath: ReadonlyMap<string, FileTreeChangeStats>;
  directoryPath: string;
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>;
  expandedPaths: ReadonlySet<string>;
  onRefreshDirectory: (directoryPath: string | null) => void;
}>) {
  const state = directoryStates.get(directoryPath);
  const name = getProjectFileName(directoryPath);
  if (state?.error !== null && state?.error !== undefined) {
    return (
      <div
        className="flex min-h-7 items-center gap-2 px-1.5 text-caption text-diff-removed"
        role="treeitem"
      >
        <span className="min-w-0 flex-1 truncate">无法读取文件夹 {name}</span>
        <IconButton
          label={`重新读取文件夹 ${name}`}
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
        aria-label={`正在读取文件夹 ${name}`}
        className="flex min-h-7 items-center gap-1.5 px-1.5 text-caption text-muted-foreground"
        role="treeitem"
      >
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        <span>正在读取...</span>
      </div>
    );
  }
  if (state.data?.entries.length === 0) {
    return (
      <div className="min-h-7 px-1.5 py-1.5 text-caption text-muted-foreground" role="treeitem">
        空文件夹
      </div>
    );
  }
  return (
    <ProjectFileTreeNodes
      changeStatsByPath={changeStatsByPath}
      directoryStates={directoryStates}
      entries={state.data?.entries ?? []}
      expandedPaths={expandedPaths}
      onRefreshDirectory={onRefreshDirectory}
    />
  );
}

function ProjectFileTreeNodes({
  changeStatsByPath,
  directoryStates,
  entries,
  expandedPaths,
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
      <FileTreeFolder key={entry.path} name={name} path={entry.path} trailing={trailing}>
        <ProjectFileTreeDirectoryChildren
          changeStatsByPath={changeStatsByPath}
          directoryPath={entry.path}
          directoryStates={directoryStates}
          expandedPaths={expandedPaths}
          onRefreshDirectory={onRefreshDirectory}
        />
      </FileTreeFolder>
    ) : (
      <FileTreeFile key={entry.path} name={name} path={entry.path} trailing={trailing} />
    );
  });
}

const reasoningEffortLabels: Readonly<Record<string, string>> = {
  high: "高",
  low: "低",
  max: "最大",
  medium: "中",
  minimal: "最低",
  none: "无",
  xhigh: "较高",
};

const sandboxModeLabels: Readonly<Record<AgentTaskSettings["sandboxMode"], string>> = {
  "danger-full-access": "完全访问",
  "read-only": "只读",
  "workspace-write": "工作区可写",
};

function formatApprovalMode(settings: AgentTaskSettings) {
  if (settings.approvalsReviewer === "auto_review") {
    return "自动审批";
  }
  const labels: Readonly<Record<AgentTaskSettings["approvalPolicy"], string>> = {
    never: "从不询问",
    "on-request": "按需审批",
    untrusted: "仅不受信任操作",
  };
  return labels[settings.approvalPolicy];
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
          detail: "图片附件",
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
    admin: "管理员",
    repo: "项目",
    system: "系统",
    user: "用户",
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
  onFileTreeExpandedChange = () => undefined,
  onOpenFileDiff = () => undefined,
  onOpenSourceFile = () => undefined,
  onOpenSubagent = () => undefined,
  onRefreshFileTreeDirectory = () => undefined,
  onRefreshGitStatus = () => undefined,
  onReviewChanges = () => undefined,
  onTerminateBackgroundTerminal = () => Promise.resolve(),
  projectName,
  projectPath,
  settings,
  skills = [],
  subagents = [],
  task,
  terminalMutationError = null,
  terminatingTerminalId = null,
}: WorkbenchInspectorProps) {
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
  const [selectedFilePath, setSelectedFilePath] = useState<string>();
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
  const branch =
    gitStatus?.branch ??
    (gitStatusPending ? "正在读取" : gitStatusError === null ? "未检出分支" : "不可用");

  return (
    <aside
      aria-label="Context Inspector"
      className="workbench-inspector z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-panel shadow-divider-reverse"
    >
      <div className="flex h-workbench-header items-center px-3">
        <h2 className="text-body-small font-semibold text-foreground">环境信息</h2>
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
              {value === "changes" ? "变更" : "上下文"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden" role="tabpanel">
        {tab === "changes" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div
              aria-label="未提交变更摘要"
              className="flex w-full items-center justify-between gap-2 px-2.5 pb-3 pt-2.5"
              role="group"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">未提交变更</p>
                <p
                  aria-label="变更统计"
                  className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground"
                >
                  <span>{allChanges.length} 个变更</span>
                  <span className="font-medium text-diff-added">+{additions}</span>
                  <span className="font-medium text-diff-removed">-{removals}</span>
                </p>
              </div>
              <div
                aria-label="变更操作"
                className="flex shrink-0 items-center justify-end gap-1.5"
                role="group"
              >
                <button
                  aria-haspopup="dialog"
                  aria-label={
                    allChanges.length === 0
                      ? "暂无未提交变更可审核"
                      : `审核 ${String(allChanges.length)} 个未提交变更`
                  }
                  className="h-7 shrink-0 rounded-control bg-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control"
                  disabled={allChanges.length === 0}
                  onClick={() => {
                    onReviewChanges(allChanges);
                  }}
                  type="button"
                >
                  审核
                </button>
                {/* 提交入口按当前产品范围仅展示，暂不绑定 Git Mutation。 */}
                <button
                  aria-label={
                    allChanges.length === 0
                      ? "暂无未提交变更可提交"
                      : `提交 ${String(allChanges.length)} 个未提交变更`
                  }
                  className="h-7 shrink-0 rounded-control bg-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control"
                  disabled={allChanges.length === 0}
                  type="button"
                >
                  提交
                </button>
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto px-2.5 pb-2.5">
              {gitStatusError !== null ? (
                <div className="mb-2 flex items-center gap-2 rounded-control bg-control px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-diff-removed">Git 变更自动检测已停止</p>
                  </div>
                  <IconButton
                    disabled={gitStatusRefreshing}
                    label="手动刷新 Git 变更"
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
                <p className="mb-2 px-2 text-caption text-muted-foreground">正在读取 Git 变更...</p>
              ) : null}
              <div className="mb-1 flex items-center justify-between px-1.5 text-meta font-medium text-muted-foreground">
                <span>项目文件</span>
              </div>
              {rootFileTreeState?.error !== null && rootFileTreeState?.error !== undefined ? (
                <div className="flex flex-col items-center px-2 py-5 text-center">
                  <p className="text-label text-diff-removed">无法读取项目文件</p>
                  <button
                    aria-label="重新读取项目文件"
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
                    {rootFileTreeState.isFetching ? "正在读取" : "重新读取"}
                  </button>
                </div>
              ) : rootFileTreeState?.isPending === true && rootFileTreeState.data === undefined ? (
                <p className="px-2 py-5 text-center text-label text-muted-foreground">
                  正在读取项目文件...
                </p>
              ) : (rootFileTreeState?.data?.entries.length ?? 0) === 0 ? (
                <p className="px-2 py-5 text-center text-label text-muted-foreground">
                  当前项目没有可显示的文件
                </p>
              ) : (
                <FileTree
                  aria-label="项目文件"
                  expanded={expandedFileTreePaths}
                  onExpandedChange={onFileTreeExpandedChange}
                  onSelect={(path) => {
                    if (!filePaths.has(path)) {
                      return;
                    }
                    setSelectedFilePath(path);
                    const fileChange = fileChangesByPath.get(path);
                    if (fileChange === undefined) {
                      onOpenSourceFile(path);
                    } else {
                      onOpenFileDiff(fileChange);
                    }
                  }}
                  {...(selectedFilePath === undefined ? {} : { selectedPath: selectedFilePath })}
                >
                  <ProjectFileTreeNodes
                    changeStatsByPath={fileTreeChangeStats}
                    directoryStates={fileTreeDirectoryStates}
                    entries={rootFileTreeState?.data?.entries ?? []}
                    expandedPaths={expandedFileTreePaths}
                    onRefreshDirectory={onRefreshFileTreeDirectory}
                  />
                </FileTree>
              )}
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
            <InspectorSection icon={<HardDrive className="size-3.5" />} title="环境">
              <InspectorRow label="模型" value={settings.model} />
              <InspectorRow
                label="思考量"
                value={reasoningEffortLabels[settings.reasoningEffort] ?? settings.reasoningEffort}
              />
              <InspectorRow label="审批" value={formatApprovalMode(settings)} />
              <InspectorRow label="沙盒" value={sandboxModeLabels[settings.sandboxMode]} />
              <InspectorRow label="工作目录" value={projectPath} />
              <InspectorRow label="分支" value={branch} />
            </InspectorSection>
            <InspectorSection icon={<FolderRoot className="size-3.5" />} title="来源">
              <div aria-label="上下文来源" className="space-y-0.5">
                {sources.map((source) => (
                  <InspectorSourceRow key={source.id} source={source} />
                ))}
              </div>
            </InspectorSection>
          </div>
        )}
      </div>
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
    <InspectorSection icon={<SquareTerminal className="size-3.5" />} title="运行中的终端">
      <section aria-label="运行中的终端">
        {isPending && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-muted-foreground">正在读取终端...</p>
        ) : error !== null && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-diff-removed">无法读取运行中的终端</p>
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
                    aria-label="终端运行中"
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
                        ? `正在停止 ${terminal.command}`
                        : `停止终端 ${terminal.command}`
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
            停止终端失败，请重试
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
    <InspectorSection icon={<Bot className="size-3.5" />} title="子代理">
      <section aria-label="子代理">
        <p className="mb-1 px-2 text-caption text-muted-foreground">{subagents.length} 个子代理</p>
        <div className="space-y-1">
          {subagents.map((subagent) => {
            const metadata = [
              subagent.model === undefined ? undefined : formatSubagentModel(subagent.model),
              subagent.reasoningEffort,
            ].filter((value): value is string => value !== undefined);
            return (
              <button
                aria-haspopup="dialog"
                aria-label={`查看子代理 ${subagent.nickname} 的输出`}
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

type InspectorRowProps = Readonly<{
  label: string;
  value: string;
}>;

function InspectorRow({ label, value }: InspectorRowProps) {
  return (
    <div className="flex min-h-7 items-center gap-2 rounded-control px-2 text-meta">
      <span className="text-muted-foreground">{label}</span>
      <span
        className="ml-auto min-w-0 truncate text-right font-medium text-foreground"
        title={value}
      >
        {value}
      </span>
    </div>
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
            <span>项目目录</span>
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
