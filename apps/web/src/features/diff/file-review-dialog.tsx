import { ChevronLeft, ChevronRight, FileCode2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { IconButton } from "../../shared/ui/icon-button.js";
import type { AgentFileChange } from "./file-change.js";
import { countFileChangeLines, getFileName } from "./file-change.js";

const PatchDiffViewer = lazy(() => import("./patch-diff-viewer.js"));

export function resolveReviewIndex(
  currentIndex: number,
  direction: "next" | "previous",
  changeCount: number,
): number {
  if (changeCount <= 0) {
    return 0;
  }
  const offset = direction === "next" ? 1 : -1;
  return Math.min(Math.max(currentIndex + offset, 0), changeCount - 1);
}

type FileReviewDialogProps = Readonly<{
  changes: readonly AgentFileChange[] | null;
  onClose: () => void;
}>;

export function FileReviewDialog({ changes, onClose }: FileReviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (changes === null) {
      return;
    }
    setCurrentIndex(0);
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, [changes]);

  if (changes === null || changes.length === 0) {
    return null;
  }

  const firstChange = changes[0];
  if (firstChange === undefined) {
    return null;
  }
  const change = changes[currentIndex] ?? firstChange;
  const fileName = getFileName(change.path);
  const { additions, removals } = countFileChangeLines(change);
  const titleId = "file-review-dialog-title";
  const navigate = (direction: "next" | "previous") => {
    setCurrentIndex((index) => resolveReviewIndex(index, direction, changes.length));
  };

  return (
    <dialog
      aria-labelledby={titleId}
      className="file-diff-dialog m-auto h-[min(86vh,58rem)] w-[min(94vw,78rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          navigate("previous");
        } else if (event.key === "ArrowRight") {
          navigate("next");
        }
      }}
      ref={dialogRef}
    >
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
        <header className="flex min-h-toolbar items-center gap-2 px-3 shadow-toolbar sm:px-4">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body-small font-semibold" id={titleId} title={change.path}>
              {fileName}
            </h2>
            <p className="truncate text-caption text-muted-foreground" title={change.path}>
              {change.path}
            </p>
          </div>
          <span className="shrink-0 text-label text-muted-foreground">
            {currentIndex + 1} / {changes.length}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              disabled={currentIndex === 0}
              label="审核上一个文件"
              onClick={() => {
                navigate("previous");
              }}
              size="small"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              disabled={currentIndex === changes.length - 1}
              label="审核下一个文件"
              onClick={() => {
                navigate("next");
              }}
              size="small"
            >
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </IconButton>
            <span className="ml-1 text-label font-medium text-diff-added">+{additions}</span>
            <span className="text-label font-medium text-diff-removed">-{removals}</span>
            <IconButton label="关闭文件审核" onClick={onClose} size="small">
              <X className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        <div className="min-h-0 overflow-auto bg-content">
          <Suspense
            fallback={
              <div
                className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
                role="status"
              >
                正在加载 Diff
              </div>
            }
          >
            <PatchDiffViewer change={change} />
          </Suspense>
        </div>
      </section>
    </dialog>
  );
}
