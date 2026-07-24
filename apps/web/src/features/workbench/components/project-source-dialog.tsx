import type { ProjectSourceFile } from "@code-agent/protocol";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { IconButton } from "../../../shared/ui/icon-button.js";

type ProjectSourceDialogProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  onClose: () => void;
  projectId: string;
  reference: MessageFileReference | null;
}>;

function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function SourceCode({
  file,
  lineNumber,
}: Readonly<{ file: ProjectSourceFile; lineNumber: number | null }>) {
  const lines = useMemo(() => file.content.split("\n"), [file.content]);
  const highlightedLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    highlightedLineRef.current?.scrollIntoView({ block: "center" });
  }, [file.content, lineNumber]);

  return (
    <div className="min-w-max py-3 font-mono text-body-small leading-6">
      {lines.map((line, lineIndex) => {
        const currentLineNumber = lineIndex + 1;
        const highlighted = currentLineNumber === lineNumber;
        return (
          <div
            className={`grid grid-cols-[4rem_minmax(0,1fr)] px-3 ${
              highlighted ? "bg-accent-soft text-accent-strong" : ""
            }`}
            data-source-line={currentLineNumber}
            key={currentLineNumber}
            ref={highlighted ? highlightedLineRef : undefined}
          >
            <span
              className={`select-none pr-4 text-right ${
                highlighted ? "text-accent" : "text-muted-foreground"
              }`}
            >
              {currentLineNumber}
            </span>
            <code className="whitespace-pre">{line.length === 0 ? " " : line}</code>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectSourceDialog({
  client,
  onClose,
  projectId,
  reference,
}: ProjectSourceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sourceQuery = useQuery({
    enabled: reference !== null,
    queryFn: () => {
      if (reference === null) {
        throw new Error("Source file reference is required");
      }
      return client.readProjectSourceFile(projectId, reference.path);
    },
    queryKey: ["projects", projectId, "source-file", reference?.path ?? null] as const,
    staleTime: 30_000,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (reference === null || dialog === null || dialog.open) {
      return;
    }
    dialog.showModal();
  }, [reference]);

  if (reference === null) {
    return null;
  }

  const sourcePath = sourceQuery.data?.path ?? reference.path;
  const titleId = "project-source-dialog-title";

  return (
    <dialog
      aria-labelledby={titleId}
      className="file-diff-dialog m-auto h-[min(82vh,54rem)] w-[min(92vw,72rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
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
        <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body-small font-semibold" id={titleId} title={sourcePath}>
              {getFileName(sourcePath)}
              {reference.lineNumber === null ? null : ` (line ${String(reference.lineNumber)})`}
            </h2>
            <p className="truncate text-caption text-muted-foreground" title={sourcePath}>
              {sourcePath}
            </p>
          </div>
          {sourceQuery.data?.truncated === true ? (
            <span className="shrink-0 text-label text-warning">内容已截断</span>
          ) : null}
          <IconButton label="关闭源文件" onClick={onClose} size="small">
            <X className="size-3.5" aria-hidden="true" />
          </IconButton>
        </header>
        <div className="min-h-0 overflow-auto bg-content">
          {sourceQuery.isPending ? (
            <div
              className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
              role="status"
            >
              正在加载源文件
            </div>
          ) : sourceQuery.error !== null ? (
            <div
              className="grid min-h-48 place-items-center text-body-small text-danger"
              role="alert"
            >
              无法加载源文件
            </div>
          ) : (
            <SourceCode file={sourceQuery.data} lineNumber={reference.lineNumber} />
          )}
        </div>
      </section>
    </dialog>
  );
}
