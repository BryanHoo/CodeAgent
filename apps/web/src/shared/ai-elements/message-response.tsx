import { createContext, memo, useContext, useMemo, type ComponentProps } from "react";
import { Block, Streamdown, StreamdownContext, type BlockProps, type Components } from "streamdown";

import { Button } from "../ui/button.js";
import { CodeComments, parseCodeComments } from "./code-comments.js";
import type { MessageFileReference } from "./message.js";

type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
};

type FileReferenceMetadata = Readonly<{
  lineNumber: string | null;
  path: string;
}>;

const MessageFileReferenceContext = createContext<
  ((reference: MessageFileReference) => void) | null
>(null);

// Agent 输出使用“绝对路径:行号”表达文件定位；渲染时拆出行号，避免把路径暴露给用户。
const LOCAL_FILE_REFERENCE_PATTERN =
  /^(?<path>(?:\/|[a-z]:[\\/]|\\\\).+?\.[a-z0-9]+?)(?::(?<line>\d+)(?::\d+)?)?$/i;
const WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?:[a-z]:[\\/]|\\\\)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const UNC_FILE_REFERENCE_PREFIX = "/__code_agent_unc__/";
const RELATIVE_FILE_REFERENCE_PREFIX = "/__code_agent_relative__/";
const RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?![a-z][a-z0-9+.-]*:|\/|#)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()\/(?!\/)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;

function decodeMarkdownFileReference(href: string): string {
  try {
    // Markdown href 遵循 URL 编码规则；预览前只解码一次，避免 Client 再次编码百分号。
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function getFileReferenceMetadata(href: string | undefined): FileReferenceMetadata | null {
  if (href === undefined) {
    return null;
  }

  const match = LOCAL_FILE_REFERENCE_PATTERN.exec(decodeMarkdownFileReference(href));
  const matchedGroups = match?.groups;
  if (matchedGroups === undefined) {
    return null;
  }

  const matchedPath = matchedGroups["path"];
  const filePath = matchedPath?.startsWith(UNC_FILE_REFERENCE_PREFIX)
    ? `//${matchedPath.slice(UNC_FILE_REFERENCE_PREFIX.length)}`
    : matchedPath?.startsWith(RELATIVE_FILE_REFERENCE_PREFIX)
      ? matchedPath.slice(RELATIVE_FILE_REFERENCE_PREFIX.length)
      : matchedPath?.match(/^\/[a-z]:[\\/]/i)
        ? matchedPath.slice(1)
        : matchedPath;
  if (filePath === undefined) {
    return null;
  }

  return {
    lineNumber: matchedGroups["line"] ?? null,
    path: filePath,
  };
}

function normalizeMarkdownFileReferences(markdown: string): string {
  // 先统一本地路径形式，再编码 Markdown 目标中不允许裸写的空白字符。
  return markdown
    .replace(WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) => {
      const normalizedReference = reference.replaceAll("\\", "/");
      if (/^[a-z]:/i.test(normalizedReference)) {
        return `/${normalizedReference}`;
      }
      return `${UNC_FILE_REFERENCE_PREFIX}${normalizedReference.slice(2)}`;
    })
    .replace(
      RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN,
      (reference) => `${RELATIVE_FILE_REFERENCE_PREFIX}${reference}`,
    )
    .replace(LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) =>
      reference.replaceAll(" ", "%20").replaceAll("\t", "%09"),
    );
}

function MarkdownLink({ children, className = "", href, node, ...props }: MarkdownLinkProps) {
  // Streamdown 注入的语法树节点不能透传给原生元素。
  void node;
  const fileReference = getFileReferenceMetadata(href);
  const onOpenFileReference = useContext(MessageFileReferenceContext);

  if (fileReference !== null) {
    const content = (
      <>
        <span>{children}</span>
        {fileReference.lineNumber === null ? null : (
          <span className="markdown-file-reference__line">
            {`(line ${fileReference.lineNumber})`}
          </span>
        )}
      </>
    );

    if (onOpenFileReference !== null) {
      return (
        <Button
          variant="ghost"
          className={`markdown-file-reference cursor-pointer text-primary underline decoration-transparent underline-offset-2 transition-colors hover:text-brand-strong hover:decoration-current ${className}`}
          data-file-reference="true"
          onClick={() => {
            onOpenFileReference({
              lineNumber:
                fileReference.lineNumber === null ? null : Number(fileReference.lineNumber),
              path: fileReference.path,
            });
          }}
          title={fileReference.path}
          type="button"
        >
          {content}
        </Button>
      );
    }

    return (
      <span
        className={`markdown-file-reference text-primary ${className}`}
        data-file-reference="true"
        title={fileReference.path}
      >
        {content}
      </span>
    );
  }

  return (
    <a
      className={`font-medium text-primary underline decoration-current/35 underline-offset-2 transition-colors hover:text-brand-strong ${className}`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  onOpenFileReference?: (reference: MessageFileReference) => void;
};

function InteractiveMessageBlock(props: BlockProps) {
  const streamdownContext = useContext(StreamdownContext);
  const interactiveContext = useMemo(
    () => ({ ...streamdownContext, isAnimating: false }),
    [streamdownContext],
  );

  // 文本仍由外层 Streamdown 执行动画，块内控件不能因此失去点击能力。
  return (
    <StreamdownContext.Provider value={interactiveContext}>
      <Block {...props} />
    </StreamdownContext.Provider>
  );
}

function MessageResponseContent({
  children,
  className = "",
  components,
  onOpenFileReference,
  ...props
}: MessageResponseProps) {
  const parsedResponse = parseCodeComments(children ?? "");
  const normalizedMarkdown = normalizeMarkdownFileReferences(parsedResponse.markdown);
  const markdownComponents: Components = {
    ...components,
    a: MarkdownLink,
  };

  return (
    <MessageFileReferenceContext.Provider value={onOpenFileReference ?? null}>
      <Streamdown
        className={`size-full break-words [&_blockquote]:border-l-2 [&_blockquote]:border-separator [&_blockquote]:pl-3 [&_code]:font-mono [&_code]:text-body-small [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_pre]:overflow-x-auto [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`}
        controls={{ code: { copy: true, download: false }, mermaid: false, table: false }}
        {...props}
        BlockComponent={InteractiveMessageBlock}
        components={markdownComponents}
      >
        {normalizedMarkdown}
      </Streamdown>
      <CodeComments comments={parsedResponse.comments} />
    </MessageFileReferenceContext.Provider>
  );
}

export const MessageResponse = memo(
  MessageResponseContent,
  (previousProps, nextProps) =>
    previousProps.children === nextProps.children &&
    previousProps.isAnimating === nextProps.isAnimating &&
    previousProps.mode === nextProps.mode &&
    previousProps.onOpenFileReference === nextProps.onOpenFileReference,
);

MessageResponse.displayName = "MessageResponse";

export default MessageResponse;
