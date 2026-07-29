import { useQuery } from "@tanstack/react-query";
import { FileCode2, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "../../../shared/ai-elements/code-block.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { getCodeLanguage } from "../../../shared/ai-elements/code-languages.js";
import { IconButton } from "../../../shared/ui/icon-button.js";

export { getCodeLanguage } from "../../../shared/ai-elements/code-languages.js";

type ProjectSourceDialogProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  onClose: () => void;
  projectId: string;
  reference: MessageFileReference | null;
}>;

function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

type SourceHeaderProps = Readonly<{
  actions?: ReactNode;
  lineNumber: number | null;
  onClose: () => void;
  sourcePath: string;
  titleId: string;
  truncated: boolean;
}>;

function SourceHeader({
  actions,
  lineNumber,
  onClose,
  sourcePath,
  titleId,
  truncated,
}: SourceHeaderProps) {
  return (
    <CodeBlockHeader className="min-h-toolbar gap-3 bg-raised px-3 shadow-toolbar sm:px-4">
      <CodeBlockTitle className="min-w-0 flex-1">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body-small font-semibold" id={titleId} title={sourcePath}>
            <CodeBlockFilename>
              {getFileName(sourcePath)}
              {lineNumber === null ? null : ` (line ${String(lineNumber)})`}
            </CodeBlockFilename>
          </h2>
          <p className="truncate text-caption text-muted-foreground" title={sourcePath}>
            {sourcePath}
          </p>
        </div>
      </CodeBlockTitle>
      {truncated ? <span className="shrink-0 text-label text-warning">内容已截断</span> : null}
      <CodeBlockActions>
        {actions}
        <IconButton label="关闭源文件" onClick={onClose} size="small">
          <X className="size-3.5" aria-hidden="true" />
        </IconButton>
      </CodeBlockActions>
    </CodeBlockHeader>
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
    queryFn: ({ signal }) => {
      if (reference === null) {
        throw new Error("Source file reference is required");
      }
      return client.readProjectSourceFile(projectId, reference.path, { signal });
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

  useEffect(() => {
    const lineNumber = reference?.lineNumber;
    if (sourceQuery.data === undefined || lineNumber === null || lineNumber === undefined) {
      return;
    }

    // 行节点由共享 CodeBlock 提供，查询完成后让所有可滚动祖先共同定位目标行。
    dialogRef.current
      ?.querySelector(`[data-code-line="${String(lineNumber)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [reference?.lineNumber, sourceQuery.data]);

  if (reference === null) {
    return null;
  }

  const sourcePath = sourceQuery.data?.path ?? reference.path;
  const titleId = "project-source-dialog-title";
  const headerProps = {
    lineNumber: reference.lineNumber,
    onClose,
    sourcePath,
    titleId,
    truncated: sourceQuery.data?.truncated === true,
  };

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
      <section className="h-full min-h-0 bg-raised">
        {sourceQuery.isPending ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <SourceHeader {...headerProps} />
            <div
              className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
              role="status"
            >
              正在加载源文件
            </div>
          </div>
        ) : sourceQuery.error !== null ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <SourceHeader {...headerProps} />
            <div
              className="grid min-h-48 place-items-center text-body-small text-danger"
              role="alert"
            >
              无法加载源文件
            </div>
          </div>
        ) : (
          <CodeBlock
            className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-none bg-content shadow-none"
            code={sourceQuery.data.content}
            highlightedLine={reference.lineNumber}
            language={getCodeLanguage(sourcePath)}
            showLineNumbers
          >
            <SourceHeader {...headerProps} actions={<CodeBlockCopyButton />} />
          </CodeBlock>
        )}
      </section>
    </dialog>
  );
}
