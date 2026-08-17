import type {
  ProjectFileSearchEntry,
  ProjectFileTree,
  ProjectFileTreeEntry,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

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
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>;
  entries: readonly ProjectFileTreeEntry[];
  onContextMenuOpen: (path: string) => void;
  onOpenProjectPath: (appId: ProjectOpenAppId, path: string) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshDirectory: (directoryPath: string | null) => void;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
}>;

export function ProjectFileTreeRootActions({
  onMenuOpen,
  onOpenProjectPath,
  onReferenceProjectPath,
  onRefreshProject,
  projectName,
  projectOpenApps,
  projectOpenPending,
  projectPath,
  refreshing = false,
}: Readonly<{
  onMenuOpen: () => void;
  onOpenProjectPath: (appId: ProjectOpenAppId) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshProject: () => unknown;
  projectName: string;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
  refreshing?: boolean;
}>) {
  const refreshLockRef = useRef(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const isRefreshing = refreshing || refreshPending;
  const refreshLabel = i18n.t("inspector.refreshProject", {
    name: projectName,
    ns: "conversation",
  });

  return (
    <FileTreeActions>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={refreshLabel}
            className={`size-5 shrink-0 transition-opacity ${
              isRefreshing
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0 group-hover/file-tree-node:pointer-events-auto group-hover/file-tree-node:opacity-100 group-focus-within/file-tree-node:pointer-events-auto group-focus-within/file-tree-node:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            }`}
            disabled={isRefreshing}
            onClick={() => {
              if (refreshLockRef.current) return;
              refreshLockRef.current = true;
              setRefreshPending(true);
              void Promise.resolve()
                .then(onRefreshProject)
                .finally(() => {
                  refreshLockRef.current = false;
                  setRefreshPending(false);
                });
            }}
            size="embedded"
            type="button"
            variant="embedded"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{refreshLabel}</TooltipContent>
      </Tooltip>
      <ProjectOpenDropdownMenu
        apps={projectOpenApps}
        isPending={projectOpenPending}
        onOpen={onMenuOpen}
        onReference={onReferenceProjectPath}
        onSelect={onOpenProjectPath}
        target={{ copyPath: projectPath, path: projectPath, type: "directory" }}
      />
    </FileTreeActions>
  );
}

function ProjectFileTreeDirectoryChildren({
  directoryPath,
  directoryStates,
  onContextMenuOpen,
  onOpenProjectPath,
  onReferenceProjectPath,
  onRefreshDirectory,
  projectOpenApps,
  projectOpenPending,
  projectPath,
}: Readonly<{
  directoryPath: string;
  directoryStates: ReadonlyMap<string | null, ProjectFileTreeDirectoryState>;
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
      directoryStates={directoryStates}
      entries={state.data?.entries ?? []}
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
  directoryStates,
  entries,
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
      <FileTreeActions>
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
            directoryPath={entry.path}
            directoryStates={directoryStates}
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
