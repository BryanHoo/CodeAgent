import type {
  ProjectFileSearchEntry,
  ProjectFileTree,
  ProjectFileTreeEntry,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";
import {
  FileTreeActions,
  FileTreeFile,
  FileTreeFolder,
} from "../../../shared/components/agent/file-tree.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { countFileChangeLines, type AgentFileChange } from "../../diff/file-change.js";
import {
  getProjectTargetCopyPath,
  ProjectOpenContextMenu,
  ProjectOpenDropdownMenu,
} from "./project-open-menu.js";

export type ProjectFileTreeDirectoryState = Readonly<{
  data?: ProjectFileTree;
  error: Error | null;
  isFetching: boolean;
  isPending: boolean;
  path: string | null;
}>;

export function getProjectFileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

type ProjectFileTreeNodesProps = Readonly<{
  changeStatsByPath: ReadonlyMap<string, FileTreeChangeStats>;
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>;
  entries: readonly ProjectFileTreeEntry[];
  expandedPaths: ReadonlySet<string>;
  onContextMenuOpen: (path: string) => void;
  onOpenProjectPath: (appId: ProjectOpenAppId, path: string) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshDirectory: (directoryPath: string | null) => void;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
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

export function collectFileTreeChangeSummary(changes: readonly AgentFileChange[]): Readonly<{
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
  onContextMenuOpen,
  onOpenProjectPath,
  onReferenceProjectPath,
  onRefreshDirectory,
  projectOpenApps,
  projectOpenPending,
  projectPath,
}: Readonly<{
  changeStatsByPath: ReadonlyMap<string, FileTreeChangeStats>;
  directoryPath: string;
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>;
  expandedPaths: ReadonlySet<string>;
  onContextMenuOpen: (path: string) => void;
  onOpenProjectPath: (appId: ProjectOpenAppId, path: string) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshDirectory: (directoryPath: string | null) => void;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={i18n.t("inspector.refreshFolder", { name, ns: "conversation" })}
              onClick={() => {
                onRefreshDirectory(directoryPath);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {i18n.t("inspector.refreshFolder", { name, ns: "conversation" })}
          </TooltipContent>
        </Tooltip>
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
      onContextMenuOpen={onContextMenuOpen}
      onOpenProjectPath={onOpenProjectPath}
      onReferenceProjectPath={onReferenceProjectPath}
      onRefreshDirectory={onRefreshDirectory}
      projectOpenApps={projectOpenApps}
      projectOpenPending={projectOpenPending}
      projectPath={projectPath}
    />
  );
}

export function ProjectFileTreeNodes({
  changeStatsByPath,
  directoryStates,
  entries,
  expandedPaths,
  onContextMenuOpen,
  onOpenProjectPath,
  onReferenceProjectPath,
  onRefreshDirectory,
  projectOpenApps,
  projectOpenPending,
  projectPath,
}: ProjectFileTreeNodesProps) {
  return entries.map((entry) => {
    const name = getProjectFileName(entry.path);
    const changeStats = getFileTreeNodeChangeStats(
      entry,
      changeStatsByPath,
      directoryStates,
      expandedPaths,
    );
    const changeIndicator =
      changeStats === undefined ? null : (
        <FileTreeChangeIndicator
          isDirectory={entry.type === "directory"}
          path={entry.path}
          stats={changeStats}
        />
      );
    const copyPath = getProjectTargetCopyPath(projectPath, entry.path);
    const target =
      entry.type === "file"
        ? {
            copyPath,
            path: entry.path,
            reference: { name, path: entry.path },
            type: "file" as const,
          }
        : {
            copyPath,
            path: entry.path,
            type: "directory" as const,
          };
    const trailing = (
      <FileTreeActions className="relative">
        <span className="transition-opacity group-hover/file-tree-node:opacity-0 group-focus-within/file-tree-node:opacity-0">
          {changeIndicator}
        </span>
        {/* 菜单覆盖统计的行尾位置，避免透明按钮仍占宽度并挤压变更数字。 */}
        <span className="absolute right-0 top-1/2 -translate-y-1/2">
          <ProjectOpenDropdownMenu
            apps={projectOpenApps}
            isPending={projectOpenPending}
            onOpen={() => {
              onContextMenuOpen(entry.path);
            }}
            onReference={onReferenceProjectPath}
            onSelect={onOpenProjectPath}
            target={target}
          />
        </span>
      </FileTreeActions>
    );
    return entry.type === "directory" ? (
      <ProjectOpenContextMenu
        apps={projectOpenApps}
        isPending={projectOpenPending}
        key={entry.path}
        onOpen={() => {
          onContextMenuOpen(entry.path);
        }}
        onReference={onReferenceProjectPath}
        onSelect={onOpenProjectPath}
        target={target}
      >
        <FileTreeFolder name={name} path={entry.path} trailing={trailing}>
          <ProjectFileTreeDirectoryChildren
            changeStatsByPath={changeStatsByPath}
            directoryPath={entry.path}
            directoryStates={directoryStates}
            expandedPaths={expandedPaths}
            onContextMenuOpen={onContextMenuOpen}
            onOpenProjectPath={onOpenProjectPath}
            onReferenceProjectPath={onReferenceProjectPath}
            onRefreshDirectory={onRefreshDirectory}
            projectOpenApps={projectOpenApps}
            projectOpenPending={projectOpenPending}
            projectPath={projectPath}
          />
        </FileTreeFolder>
      </ProjectOpenContextMenu>
    ) : (
      <ProjectOpenContextMenu
        apps={projectOpenApps}
        isPending={projectOpenPending}
        key={entry.path}
        onOpen={() => {
          onContextMenuOpen(entry.path);
        }}
        onReference={onReferenceProjectPath}
        onSelect={onOpenProjectPath}
        target={target}
      >
        <FileTreeFile name={name} path={entry.path} trailing={trailing} />
      </ProjectOpenContextMenu>
    );
  });
}
