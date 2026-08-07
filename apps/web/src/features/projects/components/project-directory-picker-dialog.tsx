import type { ProjectDirectoryListing } from "@code-agent/protocol";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowUp, FolderPlus, LoaderCircle, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { FileTree, FileTreeFolder } from "../../../shared/components/agent/file-tree.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { CodeAgentProjectDirectoryClient } from "../project-queries.js";

export type ProjectDirectoryState = Readonly<{
  data?: ProjectDirectoryListing;
  error: Error | null;
  isFetching: boolean;
  path: string;
}>;

type ProjectDirectoryTreeProps = Readonly<{
  directoryStates: readonly ProjectDirectoryState[];
  expandedPaths: Set<string>;
  listing: ProjectDirectoryListing;
  onExpandedChange: (paths: Set<string>) => void;
  onRetry: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string;
}>;

type ProjectDirectoryNodesProps = Readonly<{
  directoryStates: ReadonlyMap<string, ProjectDirectoryState>;
  entries: ProjectDirectoryListing["entries"];
  expandedPaths: Set<string>;
  onRetry: (path: string) => void;
}>;

function ProjectDirectoryNodes({
  directoryStates,
  entries,
  expandedPaths,
  onRetry,
}: ProjectDirectoryNodesProps) {
  const { t } = useTranslation("workbench");
  return entries.map((entry) => {
    const state = directoryStates.get(entry.path);
    const isExpanded = expandedPaths.has(entry.path);
    return (
      <FileTreeFolder
        key={entry.path}
        name={entry.name}
        path={entry.path}
        trailing={
          isExpanded && state?.isFetching === true ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin text-muted-foreground"
            />
          ) : undefined
        }
      >
        {!isExpanded ? null : state?.error !== null && state?.error !== undefined ? (
          <div className="flex min-h-9 items-center justify-between gap-2 px-2 py-1">
            <p className="min-w-0 text-caption text-danger" role="alert">
              {t("projectPicker.loadBranchError")}
            </p>
            <Button
              className="shrink-0"
              onClick={() => {
                onRetry(entry.path);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {t("actions.retry")}
            </Button>
          </div>
        ) : state?.data === undefined ? (
          <p className="px-2 py-1.5 text-caption text-muted-foreground" role="status">
            {t("projectPicker.loadingBranch")}
          </p>
        ) : state.data.entries.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-muted-foreground">
            {t("projectPicker.empty")}
          </p>
        ) : (
          <ProjectDirectoryNodes
            directoryStates={directoryStates}
            entries={state.data.entries}
            expandedPaths={expandedPaths}
            onRetry={onRetry}
          />
        )}
      </FileTreeFolder>
    );
  });
}

export function ProjectDirectoryTree({
  directoryStates,
  expandedPaths,
  listing,
  onExpandedChange,
  onRetry,
  onSelect,
  selectedPath,
}: ProjectDirectoryTreeProps) {
  const { t } = useTranslation("workbench");
  const directoryStateMap = useMemo(
    () => new Map(directoryStates.map((state) => [state.path, state])),
    [directoryStates],
  );
  return (
    <FileTree
      aria-label={t("projectPicker.treeLabel")}
      expanded={expandedPaths}
      onExpandedChange={onExpandedChange}
      onSelect={onSelect}
      selectedPath={selectedPath}
    >
      <ProjectDirectoryNodes
        directoryStates={directoryStateMap}
        entries={listing.entries}
        expandedPaths={expandedPaths}
        onRetry={onRetry}
      />
    </FileTree>
  );
}

type ProjectDirectoryPickerDialogProps = Readonly<{
  addError: Error | null;
  client: CodeAgentProjectDirectoryClient;
  isAdding: boolean;
  onAdd: (path: string) => Promise<void> | void;
  onClose: () => void;
}>;

export function ProjectDirectoryPickerDialog({
  addError,
  client,
  isAdding,
  onAdd,
  onClose,
}: ProjectDirectoryPickerDialogProps) {
  const { t } = useTranslation("workbench");
  const [rootPath, setRootPath] = useState<string>();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string>();
  const rootQuery = useQuery({
    queryFn: ({ signal }) => client.listProjectDirectories(rootPath, { signal }),
    queryKey: ["project-directories", rootPath ?? null] as const,
    staleTime: 30_000,
  });
  const listing = rootQuery.data;
  const activeSelectedPath = selectedPath ?? listing?.path;
  const canAdd = listing !== undefined && activeSelectedPath !== undefined;
  const expandedDirectoryPaths = useMemo(() => [...expandedPaths], [expandedPaths]);
  // 仅为当前展开的节点创建 Query，折叠目录不会预读整棵主机文件树。
  const directoryQueries = useQueries({
    queries: expandedDirectoryPaths.map((path) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        client.listProjectDirectories(path, { signal }),
      queryKey: ["project-directories", path] as const,
      staleTime: 30_000,
    })),
  });
  const directoryStates = expandedDirectoryPaths.map<ProjectDirectoryState>((path, index) => {
    const query = directoryQueries[index];
    return {
      ...(query?.data === undefined ? {} : { data: query.data }),
      error: query?.error ?? null,
      isFetching: query?.isFetching ?? false,
      path,
    };
  });
  const navigateToParent = () => {
    const parentPath = listing?.parentPath;
    if (parentPath === null || parentPath === undefined) return;
    // 切换浏览根目录时同步清空旧分支状态，避免把另一层级的选择和展开形态带入新树。
    setRootPath(parentPath);
    setExpandedPaths(new Set());
    setSelectedPath(parentPath);
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isAdding) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby="project-directory-picker-title"
        className="grid h-[min(84dvh,42rem)] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (isAdding) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isAdding) event.preventDefault();
        }}
      >
        <DialogHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <DialogTitle id="project-directory-picker-title">{t("projectPicker.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("projectPicker.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-10 items-center gap-2 border-y border-separator bg-panel px-3 sm:px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("projectPicker.parent")}
                disabled={listing?.parentPath === null || listing === undefined}
                onClick={navigateToParent}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("projectPicker.parent")}</TooltipContent>
          </Tooltip>
          <p
            className="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground"
            title={listing?.path}
          >
            {listing?.path ?? t("projectPicker.resolvingPath")}
          </p>
        </div>

        <div className="min-h-0 overflow-y-auto px-3 py-2 sm:px-4">
          {rootQuery.isPending ? (
            <p
              className="flex min-h-32 items-center justify-center gap-2 text-body-small text-muted-foreground"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {t("projectPicker.loading")}
            </p>
          ) : rootQuery.error !== null ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-body-small text-danger" role="alert">
                {t("projectPicker.loadError")}
              </p>
              <Button onClick={() => void rootQuery.refetch()} type="button" variant="outline">
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {t("actions.retry")}
              </Button>
            </div>
          ) : listing === undefined || activeSelectedPath === undefined ? null : listing.entries
              .length === 0 ? (
            <p className="grid min-h-32 place-items-center text-body-small text-muted-foreground">
              {t("projectPicker.empty")}
            </p>
          ) : (
            <ProjectDirectoryTree
              directoryStates={directoryStates}
              expandedPaths={expandedPaths}
              listing={listing}
              onExpandedChange={setExpandedPaths}
              onRetry={(path) => {
                const index = expandedDirectoryPaths.indexOf(path);
                void directoryQueries[index]?.refetch();
              }}
              onSelect={setSelectedPath}
              selectedPath={activeSelectedPath}
            />
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-separator bg-raised px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p
              aria-live="polite"
              className="truncate font-mono text-caption text-foreground"
              title={activeSelectedPath}
            >
              {activeSelectedPath ?? t("projectPicker.noSelection")}
            </p>
            {addError === null ? null : (
              <p className="text-meta text-danger" role="alert">
                {t("projectPicker.addError")}
              </p>
            )}
          </div>
          <DialogFooter className="w-full flex-col-reverse sm:w-auto sm:flex-row">
            <Button
              className="h-10 w-full sm:h-8 sm:w-auto"
              disabled={isAdding}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              {t("actions.cancel")}
            </Button>
            <Button
              className="h-10 w-full sm:h-8 sm:w-auto"
              disabled={!canAdd || isAdding}
              onClick={() => {
                if (activeSelectedPath !== undefined) void onAdd(activeSelectedPath);
              }}
              type="button"
            >
              {isAdding ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <FolderPlus aria-hidden="true" data-icon="inline-start" />
              )}
              {t(isAdding ? "projectPicker.adding" : "projectPicker.add")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
