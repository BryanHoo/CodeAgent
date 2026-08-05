import { FilePenLine, Files, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { v4 as createUuid } from "uuid";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/ui/button.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";

import {
  countFileChangeLines,
  getFileName,
  summarizeFileChanges,
  type AgentFileChange,
} from "../../diff/file-change.js";

export function FileChangeButton({
  change,
  onOpen,
}: Readonly<{ change: AgentFileChange; onOpen: (change: AgentFileChange) => void }>) {
  const fileName = getFileName(change.path);
  const operationLabel = i18n.t(`timeline.fileOperation.${change.kind}`, {
    ns: "conversation",
  });
  const { additions, removals } = countFileChangeLines(change);

  return (
    <Button
      variant="ghost"
      aria-haspopup="dialog"
      aria-label={i18n.t("timeline.fileChange", {
        additions,
        name: fileName,
        ns: "conversation",
        operation: operationLabel,
        removals,
      })}
      className="flex min-h-9 w-full items-center gap-2 rounded-control bg-control px-2.5 text-left text-label text-foreground transition-colors hover:bg-control-hover"
      data-file-change={change.kind}
      onClick={() => {
        onOpen(change);
      }}
      type="button"
    >
      <FilePenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 text-muted-foreground">{operationLabel}</span>
      <span className="min-w-0 truncate font-medium" title={change.path}>
        {fileName}
      </span>
      <span className="ml-auto shrink-0 text-diff-added">+{additions}</span>
      <span className="shrink-0 text-diff-removed">-{removals}</span>
    </Button>
  );
}

export function ChangedFilesCard({
  canRollback,
  changes,
  onOpenFileDiff,
  onReviewFileChanges,
  onRollback,
}: Readonly<{
  canRollback: boolean;
  changes: readonly AgentFileChange[];
  onOpenFileDiff: (change: AgentFileChange) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollback: (idempotencyKey: string) => Promise<void>;
}>) {
  const [expanded, setExpanded] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackPending, setRollbackPending] = useState(false);
  const [rollbackIdempotencyKey] = useState(() => createUuid());
  const rollbackLockRef = useRef(createAsyncActionLock());
  const summary = summarizeFileChanges(changes);
  const visibleChanges = expanded ? summary.changes : summary.changes.slice(0, 3);
  const hiddenChangeCount = summary.changes.length - visibleChanges.length;

  const rollback = () =>
    rollbackLockRef.current.run(async () => {
      setRollbackPending(true);
      setRollbackError(null);
      try {
        await onRollback(rollbackIdempotencyKey);
      } catch (error) {
        setRollbackError(
          error instanceof Error
            ? error.message
            : i18n.t("timeline.rollbackError", { ns: "conversation" }),
        );
      } finally {
        setRollbackPending(false);
      }
    });

  return (
    <section
      aria-label={i18n.t("timeline.changedFiles", {
        count: summary.changes.length,
        ns: "conversation",
      })}
      className="mt-4 w-full overflow-hidden rounded-surface border border-separator-strong bg-raised shadow-control"
    >
      <header className="flex min-h-16 items-center gap-3 px-3 py-2.5 shadow-toolbar">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-control text-muted-foreground">
          <Files className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body-small font-semibold">
            {i18n.t("timeline.editedFiles", {
              count: summary.changes.length,
              ns: "conversation",
            })}
          </h3>
          <p className="mt-0.5 text-label text-muted-foreground">
            <span className="text-diff-added">+{summary.additions}</span>{" "}
            <span className="text-diff-removed">-{summary.removals}</span>
          </p>
        </div>
        {canRollback ? (
          <Button
            variant="ghost"
            className="inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover disabled:cursor-wait disabled:opacity-55"
            disabled={rollbackPending}
            onClick={() => {
              void rollback();
            }}
            type="button"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {rollbackPending
              ? i18n.t("timeline.rollingBack", { ns: "conversation" })
              : i18n.t("timeline.rollback", { ns: "conversation" })}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          aria-haspopup="dialog"
          className="h-8 rounded-control bg-control px-3 text-label font-semibold text-foreground transition-colors hover:bg-control-hover"
          onClick={() => {
            onReviewFileChanges(summary.changes);
          }}
          type="button"
        >
          {i18n.t("timeline.review", { ns: "conversation" })}
        </Button>
      </header>
      <div className="space-y-1 p-2">
        {visibleChanges.map((change) => (
          <FileChangeButton change={change} key={change.path} onOpen={onOpenFileDiff} />
        ))}
        {hiddenChangeCount > 0 ? (
          <Button
            variant="ghost"
            className="h-8 w-full rounded-control px-2.5 text-left text-label font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
            onClick={() => {
              setExpanded(true);
            }}
            type="button"
          >
            {i18n.t("timeline.moreFiles", {
              count: hiddenChangeCount,
              ns: "conversation",
            })}
          </Button>
        ) : null}
        {expanded && summary.changes.length > 3 ? (
          <Button
            variant="ghost"
            className="h-8 w-full rounded-control px-2.5 text-left text-label font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
            onClick={() => {
              setExpanded(false);
            }}
            type="button"
          >
            {i18n.t("timeline.collapseFiles", { ns: "conversation" })}
          </Button>
        ) : null}
      </div>
      {rollbackError === null ? null : (
        <p className="px-3 pb-3 text-label text-danger" role="alert">
          {rollbackError}
        </p>
      )}
    </section>
  );
}
