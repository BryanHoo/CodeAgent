import { useInfiniteQuery } from "@tanstack/react-query";
import { History, X } from "lucide-react";
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { cn } from "../../../shared/lib/utils.js";
import { Button } from "../../../shared/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/ui/dialog.js";
import type { CodeAgentGitHistoryClient } from "../../projects/project-queries.js";
import { projectGitHistoryInfiniteQueryOptions } from "../../projects/project-queries.js";
import { GitHistoryContent, GitHistoryList } from "./git-history-list.js";

type GitHistoryDialogProps = Readonly<{
  client: CodeAgentGitHistoryClient;
  onClose: () => void;
  projectId: string;
}>;

type QueriedGitHistoryPanelProps = Readonly<{
  active: boolean;
  client: CodeAgentGitHistoryClient;
  dateFormatter: Intl.DateTimeFormat;
  onBranchLoaded: (repository: string, branch: string | null) => void;
  panelId: string;
  projectId: string;
  repository: string;
}>;

function QueriedGitHistoryPanel({
  active,
  client,
  dateFormatter,
  onBranchLoaded,
  panelId,
  projectId,
  repository,
}: QueriedGitHistoryPanelProps) {
  return (
    <GitHistoryList
      active={active}
      client={client}
      dateFormatter={dateFormatter}
      onBranchLoaded={onBranchLoaded}
      panelId={panelId}
      projectId={projectId}
      repository={repository}
    />
  );
}

function getPanelId(index: number): string {
  return `git-history-panel-${String(index)}`;
}

export function GitHistoryDialog({ client, onClose, projectId }: GitHistoryDialogProps) {
  useTranslation("conversation");
  const [selectedRepository, setSelectedRepository] = useState<string>();
  const [visitedRepositories, setVisitedRepositories] = useState<readonly string[]>([]);
  const [repositoryBranches, setRepositoryBranches] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );
  const initialQuery = useInfiniteQuery(
    projectGitHistoryInfiniteQueryOptions(projectId, undefined, true, client),
  );
  const initialPage = initialQuery.data?.pages[0];
  const initialRepository = initialPage?.repository ?? null;
  const activeRepository = selectedRepository ?? initialRepository;
  const repositories = initialPage?.repositories ?? [];
  const initialRepositoryIndex = Math.max(
    0,
    initialRepository === null ? 0 : repositories.indexOf(initialRepository),
  );
  const initialPanelId =
    repositories.length === 0 ? "git-history-panel" : getPanelId(initialRepositoryIndex);
  const activeBranch =
    selectedRepository === undefined
      ? initialPage?.branch
      : repositoryBranches.get(selectedRepository);
  const displayBranch = activeBranch === undefined ? null : (activeBranch ?? "detached HEAD");
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage === "en" ? "en" : "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [],
  );

  const selectRepository = (repository: string) => {
    if (repository === initialRepository) {
      setSelectedRepository(undefined);
      return;
    }
    // 已访问仓库保持挂载，切回 Tab 时复用原查询与列表 DOM，避免弹窗内容闪烁。
    setVisitedRepositories((current) =>
      current.includes(repository) ? current : [...current, repository],
    );
    setSelectedRepository(repository);
  };

  const rememberRepositoryBranch = useCallback((repository: string, branch: string | null) => {
    setRepositoryBranches((current) => {
      if (current.has(repository) && current.get(repository) === branch) {
        return current;
      }
      return new Map(current).set(repository, branch);
    });
  }, []);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + repositories.length) % repositories.length;
    const nextRepository = repositories[nextIndex];
    if (nextRepository !== undefined) {
      selectRepository(nextRepository);
      document.querySelector<HTMLButtonElement>(`#git-history-tab-${String(nextIndex)}`)?.focus();
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby="git-history-title"
        className="h-[min(88dvh,44rem)] max-w-[46rem] overflow-hidden p-0"
      >
        {/* 固定外层高度，避免首次切换 Tab 时短加载态触发 Dialog 缩放和重新居中。 */}
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-separator px-4">
            <div className="flex min-w-0 items-center gap-2">
              <History aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <DialogTitle className="truncate text-body-small" id="git-history-title">
                  {i18n.t("gitHistory.title", { ns: "conversation" })}
                </DialogTitle>
                <p
                  className="truncate text-caption text-muted-foreground"
                  title={displayBranch ?? undefined}
                >
                  {displayBranch === null
                    ? i18n.t("gitHistory.branchLoading", { ns: "conversation" })
                    : i18n.t("gitHistory.branch", {
                        branch: displayBranch,
                        ns: "conversation",
                      })}
                </p>
              </div>
            </div>
            <Button
              aria-label={i18n.t("gitHistory.close", { ns: "conversation" })}
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </header>

          {repositories.length === 0 ? null : (
            <div
              aria-label={i18n.t("gitHistory.repositories", { ns: "conversation" })}
              className="flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-separator px-3 py-2"
              role="tablist"
            >
              {repositories.map((repository, index) => {
                const active = repository === activeRepository;
                return (
                  <Button
                    aria-controls={getPanelId(index)}
                    aria-selected={active}
                    className={cn(
                      "h-7 shrink-0 rounded-control px-2.5 text-label max-workbench:h-11",
                      active
                        ? "bg-control text-foreground"
                        : "text-muted-foreground hover:bg-control-hover hover:text-foreground",
                    )}
                    id={`git-history-tab-${String(index)}`}
                    key={repository}
                    onClick={() => {
                      selectRepository(repository);
                    }}
                    onKeyDown={(event) => {
                      handleTabKeyDown(event, index);
                    }}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    type="button"
                    variant="ghost"
                  >
                    {repository}
                  </Button>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1" data-slot="git-history-panels">
            <GitHistoryContent
              active={selectedRepository === undefined}
              dateFormatter={dateFormatter}
              panelId={initialPanelId}
              query={initialQuery}
            />
            {visitedRepositories.map((repository) => {
              const repositoryIndex = repositories.indexOf(repository);
              if (repositoryIndex < 0) {
                return null;
              }
              return (
                <QueriedGitHistoryPanel
                  active={selectedRepository === repository}
                  client={client}
                  dateFormatter={dateFormatter}
                  key={repository}
                  onBranchLoaded={rememberRepositoryBranch}
                  panelId={getPanelId(repositoryIndex)}
                  projectId={projectId}
                  repository={repository}
                />
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
