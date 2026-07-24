import { FileCode2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef } from "react";

import { IconButton } from "../../shared/ui/icon-button.js";
import type { AgentFileChange } from "./file-change.js";
import { countFileChangeLines, getFileName } from "./file-change.js";

const PatchDiffViewer = lazy(() => import("./patch-diff-viewer.js"));

type FileDiffDialogProps = Readonly<{
  change: AgentFileChange | null;
  onClose: () => void;
}>;

export function FileDiffDialog({ change, onClose }: FileDiffDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (change === null || dialog === null || dialog.open) {
      return;
    }

    // showModal 提供焦点圈定与原生 Escape 行为，避免手写不完整的弹层交互。
    dialog.showModal();
  }, [change]);

  if (change === null) {
    return null;
  }

  const fileName = getFileName(change.path);
  const { additions, removals } = countFileChangeLines(change);
  const titleId = "file-diff-dialog-title";

  return (
    <dialog
      aria-labelledby={titleId}
      className="file-diff-dialog m-auto h-[min(82vh,54rem)] w-[min(92vw,72rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // 只有点击原生 backdrop 对应的 dialog 空白区域时关闭，正文点击不冒泡关闭。
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
        <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body-small font-semibold" id={titleId} title={change.path}>
              {fileName}
            </h2>
            <p className="truncate text-caption text-muted-foreground" title={change.path}>
              {change.path}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-label font-medium">
            <span className="text-diff-added">+{additions}</span>
            <span className="text-diff-removed">-{removals}</span>
            <IconButton label="关闭文件 Diff" onClick={onClose} size="small">
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
