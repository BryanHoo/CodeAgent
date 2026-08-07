import { useQuery } from "@tanstack/react-query";
import { buildProjectImageFileUrl } from "@code-agent/client";
import { Code2, Eye, FileCode2, Image, X } from "lucide-react";
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
import { LazyMessageResponse } from "../../../shared/ai-elements/lazy-message-response.js";
import type { MessageFileReference } from "../../../shared/ai-elements/message.js";
import { getCodeLanguage } from "../../../shared/ai-elements/code-languages.js";
import { Button } from "../../../shared/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/ui/dialog.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";

export { getCodeLanguage } from "../../../shared/ai-elements/code-languages.js";

type ProjectSourceDialogProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  onClose: () => void;
  previewKind: "image" | "source";
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
  previewKind: "image" | "source";
  sourcePath: string;
  titleId: string;
  truncated: boolean;
}>;

function SourceHeader({
  actions,
  lineNumber,
  onClose,
  previewKind,
  sourcePath,
  titleId,
  truncated,
}: SourceHeaderProps) {
  const { t } = useTranslation("workbench");
  return (
    <CodeBlockHeader className="min-h-toolbar gap-3 bg-raised px-3 shadow-toolbar sm:px-4">
      <CodeBlockTitle className="min-w-0 flex-1">
        {previewKind === "image" ? (
          <Image className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <DialogTitle asChild>
            <h2 className="truncate text-body-small font-semibold" id={titleId} title={sourcePath}>
              <CodeBlockFilename>
                {getFileName(sourcePath)}
                {lineNumber === null ? null : ` (line ${String(lineNumber)})`}
              </CodeBlockFilename>
            </h2>
          </DialogTitle>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t(
                previewKind === "image"
                  ? "projectDialog.closeImagePreview"
                  : "projectDialog.closeSource",
              )}
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t(
              previewKind === "image"
                ? "projectDialog.closeImagePreview"
                : "projectDialog.closeSource",
            )}
          </TooltipContent>
        </Tooltip>
      </CodeBlockActions>
    </CodeBlockHeader>
  );
}

export function ProjectSourceDialog({
  client,
  onClose,
  previewKind,
  projectId,
  reference,
}: ProjectSourceDialogProps) {
  const { t } = useTranslation("workbench");
  const contentRef = useRef<HTMLDivElement>(null);
  // 渲染状态绑定源文件路径，切换文件或关闭弹窗后必须回到原始内容。
  const [renderedMarkdownPath, setRenderedMarkdownPath] = useState<string | null>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const sourceQuery = useQuery({
    enabled: reference !== null && previewKind === "source",
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
    setImageLoadFailed(false);
  }, [previewKind, reference?.path]);

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
    contentRef.current
      ?.querySelector(`[data-code-line="${String(lineNumber)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [reference?.lineNumber, renderedMarkdownPath, sourceQuery.data]);

  if (reference === null) {
    return null;
  }

  const sourcePath = sourceQuery.data?.path ?? reference.path;
  const fileName = getFileName(sourcePath);
  const imageUrl = buildProjectImageFileUrl("", projectId, reference.path);
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
    previewKind,
    sourcePath,
    titleId,
    truncated: sourceQuery.data?.truncated === true,
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby={titleId}
        className="h-[min(82dvh,54rem)] max-w-[72rem] overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          // 预览内可能存在 Tooltip 等可关闭层；当前 Dialog 始终优先响应 Escape。
          event.preventDefault();
          handleClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            handleClose();
          }
        }}
        ref={contentRef}
      >
        <section className="h-full min-h-0 bg-raised">
          {previewKind === "image" ? (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
              <SourceHeader {...headerProps} />
              <div className="grid min-h-0 place-items-center overflow-auto p-4 sm:p-6">
                {imageLoadFailed ? (
                  <div className="text-body-small text-danger" role="alert">
                    {t("projectDialog.loadImageError")}
                  </div>
                ) : (
                  <img
                    alt={fileName}
                    className="max-h-full max-w-full object-contain"
                    decoding="async"
                    onError={() => {
                      setImageLoadFailed(true);
                    }}
                    src={imageUrl}
                  />
                )}
              </div>
            </div>
          ) : sourceQuery.isPending ? (
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("projectDialog.showRawContent")}
                        onClick={() => {
                          setRenderedMarkdownPath(null);
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Code2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("projectDialog.showRawContent")}</TooltipContent>
                  </Tooltip>
                }
              />
              <div className="min-h-0 overflow-auto px-5 py-4 sm:px-8 sm:py-6">
                <LazyMessageResponse className="mx-auto max-w-4xl">
                  {sourceQuery.data.content}
                </LazyMessageResponse>
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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={t("projectDialog.previewMarkdown")}
                            onClick={() => {
                              setRenderedMarkdownPath(sourcePath);
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("projectDialog.previewMarkdown")}</TooltipContent>
                      </Tooltip>
                    ) : null}
                    <CodeBlockCopyButton />
                  </>
                }
              />
            </CodeBlock>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
