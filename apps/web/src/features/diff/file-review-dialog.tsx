import { ChevronDown, ChevronUp, FileCode2, Files, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "../../shared/ui/icon-button.js";
import { useTranslation } from "../../i18n/i18n.js";
import type { AgentFileChange } from "./file-change.js";
import { countFileChangeLines, getFileName } from "./file-change.js";

const PatchDiffViewer = lazy(() => import("./patch-diff-viewer.js"));

export type ReviewFileListItem = Readonly<{
  additions: number;
  changeIndex: number;
  name: string;
  path: string;
  removals: number;
}>;

export function buildReviewFileList(
  changes: readonly AgentFileChange[],
): readonly ReviewFileListItem[] {
  return changes.map((change, changeIndex) => {
    const { additions, removals } = countFileChangeLines(change);
    return {
      additions,
      changeIndex,
      name: getFileName(change.path),
      path: change.path,
      removals,
    };
  });
}

export function getReviewNavigationDirection(key: string): "next" | "previous" | null {
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return "previous";
  }
  if (key === "ArrowDown" || key === "ArrowRight") {
    return "next";
  }
  return null;
}

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
  const { t } = useTranslation("workbench");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const fileItems = useMemo(() => buildReviewFileList(changes ?? []), [changes]);

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

  useEffect(() => {
    if (changes === null) {
      return;
    }
    // 切换后原焦点按钮可能变为 disabled；窗口级监听保证四个方向键不因焦点丢失而中断。
    const handleReviewKeyDown = (event: KeyboardEvent) => {
      const direction = getReviewNavigationDirection(event.key);
      if (direction !== null) {
        event.preventDefault();
        setCurrentIndex((index) => resolveReviewIndex(index, direction, changes.length));
      }
    };
    window.addEventListener("keydown", handleReviewKeyDown);
    return () => {
      window.removeEventListener("keydown", handleReviewKeyDown);
    };
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
              label={t("diff.previousFile")}
              onClick={() => {
                navigate("previous");
              }}
              size="small"
            >
              <ChevronUp className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              disabled={currentIndex === changes.length - 1}
              label={t("diff.nextFile")}
              onClick={() => {
                navigate("next");
              }}
              size="small"
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton label={t("diff.closeReview")} onClick={onClose} size="small">
              <X className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(12rem,26%)] bg-content">
          <section aria-label={t("diff.reviewContent")} className="min-h-0 overflow-auto">
            <Suspense
              fallback={
                <div
                  className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
                  role="status"
                >
                  {t("diff.loading")}
                </div>
              }
            >
              <PatchDiffViewer change={change} />
            </Suspense>
          </section>
          <aside
            aria-label={t("diff.changedFilesNavigation")}
            className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-separator bg-panel"
          >
            <div className="flex min-h-toolbar items-center gap-2 border-b border-separator px-3">
              <Files aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <h3 className="min-w-0 flex-1 truncate text-label font-semibold">
                {t("diff.changedFiles")}
              </h3>
              <span className="text-meta text-muted-foreground">{changes.length}</span>
            </div>
            <div className="min-h-0 overflow-y-auto px-2 py-2">
              <ul aria-label={t("diff.changedFilesList")} className="space-y-1">
                {fileItems.map((item) => {
                  const isSelected = item.changeIndex === currentIndex;
                  return (
                    <li key={`${item.path}:${String(item.changeIndex)}`}>
                      <button
                        aria-current={isSelected ? "true" : undefined}
                        aria-label={t("diff.fileStats", {
                          additions: item.additions,
                          path: item.path,
                          removals: item.removals,
                        })}
                        className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-control px-2 py-2 text-left transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none ${isSelected ? "bg-control" : ""}`}
                        onClick={() => {
                          setCurrentIndex(item.changeIndex);
                        }}
                        type="button"
                      >
                        <FileCode2 aria-hidden="true" className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-label font-medium" title={item.name}>
                            {item.name}
                          </span>
                          {item.path === item.name ? null : (
                            <span
                              className="block truncate text-meta text-muted-foreground"
                              title={item.path}
                            >
                              {item.path}
                            </span>
                          )}
                        </span>
                        <span
                          className="flex shrink-0 items-center gap-1 text-meta"
                          aria-hidden="true"
                        >
                          <span className="font-medium text-diff-added">+{item.additions}</span>
                          <span className="font-medium text-diff-removed">-{item.removals}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </dialog>
  );
}
