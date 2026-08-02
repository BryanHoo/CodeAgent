import { useQuery } from "@tanstack/react-query";
import { Code2, Eye, FileCode2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "../../../shared/ai-elements/code-block.js";
import { MessageResponse, type MessageFileReference } from "../../../shared/ai-elements/message.js";
import { getCodeLanguage } from "../../../shared/ai-elements/code-languages.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import { useTranslation } from "../../../i18n/i18n.js";

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
  const { t } = useTranslation("workbench");
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
      {truncated ? (
        <span className="shrink-0 text-label text-warning">
          {t("projectDialog.sourceTruncated")}
        </span>
      ) : null}
      <CodeBlockActions>
        {actions}
        <IconButton label={t("projectDialog.closeSource")} onClick={onClose} size="small">
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
  const { t } = useTranslation("workbench");
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 渲染状态绑定源文件路径，切换文件或关闭弹窗后必须回到原始内容。
  const [renderedMarkdownPath, setRenderedMarkdownPath] = useState<string | null>(null);
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
    if (
      sourceQuery.data === undefined ||
      lineNumber === null ||
      lineNumber === undefined ||
      renderedMarkdownPath === sourceQuery.data.path
    ) {
      return;
    }

    // 行节点由共享 CodeBlock 提供，查询完成后让所有可滚动祖先共同定位目标行。
    dialogRef.current
      ?.querySelector(`[data-code-line="${String(lineNumber)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [reference?.lineNumber, renderedMarkdownPath, sourceQuery.data]);

  if (reference === null) {
    return null;
  }

  const sourcePath = sourceQuery.data?.path ?? reference.path;
  const sourceLanguage = getCodeLanguage(sourcePath);
  const canRenderMarkdown = sourceLanguage === "markdown" || sourceLanguage === "mdx";
  const showRenderedMarkdown = canRenderMarkdown && renderedMarkdownPath === sourcePath;
  const titleId = "project-source-dialog-title";
  const handleClose = () => {
    setRenderedMarkdownPath(null);
    onClose();
  };
  const headerProps = {
    lineNumber: reference.lineNumber,
    onClose: handleClose,
    sourcePath,
    titleId,
    truncated: sourceQuery.data?.truncated === true,
  };

  return (
    // 原生 dialog 已通过 onCancel 提供 Escape 行为，onClick 仅识别不可聚焦的 backdrop。
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      aria-labelledby={titleId}
      className="file-diff-dialog m-auto h-[min(82vh,54rem)] w-[min(92vw,72rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
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
              {t("projectDialog.loadingSource")}
            </div>
          </div>
        ) : sourceQuery.error !== null ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <SourceHeader {...headerProps} />
            <div
              className="grid min-h-48 place-items-center text-body-small text-danger"
              role="alert"
            >
              {t("projectDialog.loadSourceError")}
            </div>
          </div>
        ) : showRenderedMarkdown ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
            <SourceHeader
              {...headerProps}
              actions={
                <IconButton
                  label={t("projectDialog.showRawContent")}
                  onClick={() => {
                    setRenderedMarkdownPath(null);
                  }}
                  size="small"
                >
                  <Code2 className="size-3.5" aria-hidden="true" />
                </IconButton>
              }
            />
            <div className="min-h-0 overflow-auto px-5 py-4 sm:px-8 sm:py-6">
              <MessageResponse className="mx-auto max-w-4xl">
                {sourceQuery.data.content}
              </MessageResponse>
            </div>
          </div>
        ) : (
          <CodeBlock
            className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-none bg-content shadow-none"
            code={sourceQuery.data.content}
            highlightedLine={reference.lineNumber}
            language={sourceLanguage}
            showLineNumbers
          >
            <SourceHeader
              {...headerProps}
              actions={
                <>
                  {canRenderMarkdown ? (
                    <IconButton
                      label={t("projectDialog.previewMarkdown")}
                      onClick={() => {
                        setRenderedMarkdownPath(sourcePath);
                      }}
                      size="small"
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                    </IconButton>
                  ) : null}
                  <CodeBlockCopyButton />
                </>
              }
            />
          </CodeBlock>
        )}
      </section>
    </dialog>
  );
}
