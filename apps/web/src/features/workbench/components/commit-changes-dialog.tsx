import type {
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  GenerateCommitMessageRequest,
  ProjectGitStatus,
} from "@code-agent/protocol";
import { ChevronDown, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { Button } from "../../../shared/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/ui/dialog.js";
import { Input } from "../../../shared/ui/input.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";

type CommitFileEntry = Readonly<{
  path: string;
  staged: boolean;
  unstaged: boolean;
}>;

type CommitChangesDialogProps = Readonly<{
  error?: Error | null;
  gitStatus: ProjectGitStatus;
  isCommitting?: boolean;
  isGenerating?: boolean;
  onClose: () => void;
  onCommit: (request: CommitProjectChangesRequest) => Promise<void>;
  onGenerateMessage: (request: GenerateCommitMessageRequest) => Promise<string>;
  result?: CommitProjectChangesResponse | null;
}>;

export function collectCommitFileEntries(status: ProjectGitStatus): readonly CommitFileEntry[] {
  const entries = new Map<string, { path: string; staged: boolean; unstaged: boolean }>();
  for (const change of status.staged) {
    entries.set(change.path, { path: change.path, staged: true, unstaged: false });
  }
  for (const change of status.unstaged) {
    const current = entries.get(change.path);
    entries.set(change.path, {
      path: change.path,
      staged: current?.staged ?? false,
      unstaged: true,
    });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function commitResultMessageKey(result: CommitProjectChangesResponse): string {
  if (result.pushStatus === "failed") {
    return "commit.commitCompletePushFailed";
  }
  if (result.pushStatus === "not_configured") {
    return "commit.commitCompleteUpstreamMissing";
  }
  return result.pushStatus === "pushed" ? "commit.commitAndPushComplete" : "commit.commitComplete";
}

export function CommitChangesDialog({
  error = null,
  gitStatus,
  isCommitting = false,
  isGenerating = false,
  onClose,
  onCommit,
  onGenerateMessage,
  result = null,
}: CommitChangesDialogProps) {
  const { t } = useTranslation("workbench");
  const entries = useMemo(() => collectCommitFileEntries(gitStatus), [gitStatus]);
  const [selectedPaths, setSelectedPaths] = useState(
    () => new Set(entries.map((entry) => entry.path)),
  );
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const commitActionLockRef = useRef(createAsyncActionLock());
  const isPending = isGenerating || isCommitting;
  const repositoryAvailable = gitStatus.repositoryMode === "root";
  const allSelected = entries.length > 0 && selectedPaths.size === entries.length;
  const canGenerate =
    repositoryAvailable && selectedPaths.size > 0 && !isPending && result === null;
  const canCommit = canGenerate && message.trim().length > 0;

  const generateMessage = () =>
    commitActionLockRef.current.run(async () => {
      const generated = await onGenerateMessage({
        expectedSnapshot: gitStatus.snapshot,
        paths: [...selectedPaths],
      });
      setMessage(generated);
    });

  const commit = (action: CommitProjectChangesRequest["action"]) =>
    commitActionLockRef.current.run(() =>
      onCommit({
        action,
        expectedSnapshot: gitStatus.snapshot,
        message,
        paths: [...selectedPaths],
      }),
    );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        aria-labelledby="commit-changes-title"
        className="max-h-[min(88dvh,46rem)] max-w-[42rem] overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <div className="grid max-h-[min(88dvh,46rem)] grid-rows-[auto_minmax(0,1fr)_auto]">
          <header className="flex h-12 items-center justify-between border-b border-separator px-4">
            <div className="min-w-0">
              <DialogTitle className="text-body-small" id="commit-changes-title">
                {t("commit.title")}
              </DialogTitle>
              <p className="truncate text-caption text-muted-foreground">
                {gitStatus.branch ?? "detached HEAD"}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t("commit.closeDialog")}
                  disabled={isPending}
                  onClick={onClose}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("actions.close")}</TooltipContent>
            </Tooltip>
          </header>

          <div className="min-h-0 px-4 py-3">
            {repositoryAvailable ? null : (
              <p
                className="mb-3 rounded-control bg-control px-3 py-2 text-label text-danger"
                role="alert"
              >
                {t("commit.multipleRepositories")}
              </p>
            )}

            <Button
              variant="ghost"
              aria-controls="commit-file-list"
              aria-expanded={filesExpanded}
              aria-label={t("commit.selectionLabel", {
                selected: selectedPaths.size,
                total: entries.length,
              })}
              className={`flex h-9 w-full items-center gap-2 border border-separator bg-panel px-3 text-left text-label hover:bg-control-hover ${filesExpanded ? "rounded-t-control" : "rounded-control"}`}
              onClick={() => {
                setFilesExpanded((current) => !current);
              }}
              type="button"
            >
              <span className="font-medium">{t("commit.selectFiles")}</span>
              <span className="ml-auto whitespace-nowrap text-muted-foreground">
                {t("commit.selectedFiles", { count: selectedPaths.size })}
              </span>
              <span className="whitespace-nowrap text-caption text-muted-foreground">
                {t("commit.totalFiles", { count: entries.length })}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 shrink-0 transition-transform ${filesExpanded ? "rotate-180" : ""}`}
              />
            </Button>

            {filesExpanded ? (
              <div
                className="max-h-[min(24dvh,14rem)] divide-y divide-separator overflow-y-auto overscroll-contain rounded-b-control border-x border-b border-separator"
                data-commit-file-list=""
                id="commit-file-list"
              >
                {/* 全选控制跟随文件列表滚动，避免占用 message 区域。 */}
                <label className="flex min-h-9 items-center gap-2 bg-control px-3 py-2 text-label font-medium">
                  <Input
                    aria-label={t("commit.selectAllFiles")}
                    checked={allSelected}
                    disabled={!repositoryAvailable || isPending || result !== null}
                    onChange={(event) => {
                      setSelectedPaths(
                        event.currentTarget.checked
                          ? new Set(entries.map((entry) => entry.path))
                          : new Set(),
                      );
                    }}
                    type="checkbox"
                  />
                  <span>{t("commit.allFiles")}</span>
                </label>
                {entries.map((entry) => (
                  <label
                    className="flex min-h-9 items-center gap-2 px-3 py-2 text-label"
                    key={entry.path}
                  >
                    <Input
                      checked={selectedPaths.has(entry.path)}
                      disabled={!repositoryAvailable || isPending || result !== null}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedPaths((current) => {
                          const next = new Set(current);
                          if (checked) {
                            next.add(entry.path);
                          } else {
                            next.delete(entry.path);
                          }
                          return next;
                        });
                      }}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 break-all">{entry.path}</span>
                    <span className="flex shrink-0 gap-1 text-meta text-muted-foreground">
                      {entry.staged ? <span>{t("commit.staged")}</span> : null}
                      {entry.unstaged ? <span>{t("commit.unstaged")}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <label className="text-label font-medium" htmlFor="commit-message">
                  {t("commit.commitMessage")}
                </label>
                <Button
                  variant="ghost"
                  className="inline-flex h-7 items-center gap-1.5 rounded-control bg-control px-2.5 text-label font-medium hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canGenerate}
                  onClick={() => {
                    void generateMessage().catch(() => undefined);
                  }}
                  type="button"
                >
                  {isGenerating ? (
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles aria-hidden="true" className="size-3.5" />
                  )}
                  {t("commit.generateMessage")}
                </Button>
              </div>
              <textarea
                className="mt-2 h-24 w-full resize-none rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small outline-none focus:border-primary focus:shadow-focus disabled:opacity-60"
                disabled={!repositoryAvailable || isPending || result !== null}
                id="commit-message"
                onChange={(event) => {
                  setMessage(event.currentTarget.value);
                }}
                value={message}
              />
            </div>

            {error === null ? null : (
              <p className="mt-3 text-label text-danger" role="alert">
                {error.message}
              </p>
            )}
            {result === null ? null : (
              <div className="mt-3" role="status">
                <p className="text-label font-medium">{t(commitResultMessageKey(result))}</p>
                <p className="mt-1 font-mono text-caption text-muted-foreground">
                  {result.commitSha.slice(0, 7)}
                </p>
              </div>
            )}
          </div>

          <footer className="flex flex-wrap justify-end gap-2 border-t border-separator px-4 py-3">
            <Button
              variant="ghost"
              className="h-8 rounded-control px-3 text-label text-muted-foreground hover:bg-control-hover hover:text-foreground disabled:opacity-50"
              disabled={isPending}
              onClick={onClose}
              type="button"
            >
              {result === null ? t("actions.cancel") : t("actions.close")}
            </Button>
            {result === null ? (
              <>
                <Button
                  variant="ghost"
                  className="h-8 rounded-control bg-control px-3 text-label font-medium hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canCommit}
                  onClick={() => {
                    void commit("commit").catch(() => undefined);
                  }}
                  type="button"
                >
                  {t("commit.commit")}
                </Button>
                <Button
                  disabled={!canCommit}
                  onClick={() => {
                    void commit("commit_and_push").catch(() => undefined);
                  }}
                  type="button"
                  variant="default"
                >
                  {isCommitting ? (
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <Upload aria-hidden="true" className="size-3.5" />
                  )}
                  {t("commit.commitAndPush")}
                </Button>
              </>
            ) : null}
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
