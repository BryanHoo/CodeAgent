import { File } from "lucide-react";
import { createContext, memo, useContext, useMemo, type ComponentProps } from "react";
import { Block, Streamdown, StreamdownContext, type BlockProps, type Components } from "streamdown";

import { Button } from "../core/button.js";
import { CodeComments, parseCodeComments } from "./code-comments.js";
import type { MessageFileReference } from "./message.js";
import { promptReferenceTokenClassName } from "./prompt-reference-token.js";

type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
};

type FileReferenceMetadata = Readonly<{
  lineNumber: string | null;
  path: string;
  prompt: boolean;
}>;

interface MarkdownNode {
  children?: MarkdownNode[];
  type?: string;
  url?: string;
  value?: string;
}

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
const PROMPT_FILE_REFERENCE_PREFIX = "/__code_agent_prompt_reference__/";
const PROMPT_FILE_REFERENCE_PATTERN =
  /(^|\s)@(?<path>[^\s,!?;:，。！？；：、()[\]{}"'`]+)(?=$|\s|[,!?;:，。！？；：、()[\]{}"'`])/gu;
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

  const decodedHref = decodeMarkdownFileReference(href);
  if (decodedHref.startsWith(PROMPT_FILE_REFERENCE_PREFIX)) {
    return {
      lineNumber: null,
      path: decodedHref.slice(PROMPT_FILE_REFERENCE_PREFIX.length),
      prompt: true,
    };
  }

  const match = LOCAL_FILE_REFERENCE_PATTERN.exec(decodedHref);
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
    prompt: false,
  };
}

function splitPromptFileReferenceText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(PROMPT_FILE_REFERENCE_PATTERN)) {
    const path = match.groups?.["path"];
    if (path === undefined) {
      continue;
    }
    const referenceStart = match.index + (match[1]?.length ?? 0);
    if (referenceStart > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, referenceStart) });
    }
    nodes.push({
      children: [{ type: "text", value: path.split("/").at(-1) ?? path }],
      type: "link",
      url: `${PROMPT_FILE_REFERENCE_PREFIX}${encodeURIComponent(path)}`,
    });
    cursor = referenceStart + path.length + 1;
  }
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}

function promptFileReferenceRemarkPlugin() {
  return (tree: MarkdownNode) => {
    // 只改写 Markdown 普通文本，已有链接和行内/块级代码由 AST 边界自然隔离。
    const transform = (node: MarkdownNode) => {
      if (node.type === "link" || node.type === "linkReference" || node.children === undefined) {
        return;
      }
      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && child.value !== undefined) {
          return splitPromptFileReferenceText(child.value);
        }
        transform(child);
        return child;
      });
    };
    transform(tree);
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
    if (fileReference.prompt) {
      const classNames = `${promptReferenceTokenClassName} relative top-0.5 select-none ${className}`;
      const content = (
        <>
          <File aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{children}</span>
        </>
      );

      if (onOpenFileReference !== null) {
        return (
          <Button
            variant="embedded"
            aria-label={`@${fileReference.path}`}
            className={`${classNames} cursor-pointer hover:bg-control-hover`}
            data-prompt-file-reference={fileReference.path}
            onClick={() => {
              onOpenFileReference({ lineNumber: null, path: fileReference.path });
            }}
            size="embedded"
            title={fileReference.path}
            type="button"
          >
            {content}
          </Button>
        );
      }

      return (
        <span
          className={classNames}
          data-prompt-file-reference={fileReference.path}
          title={fileReference.path}
        >
          {content}
        </span>
      );
    }

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
          className={`markdown-file-reference cursor-pointer text-brand underline decoration-transparent underline-offset-2 transition-colors hover:text-brand-strong hover:decoration-current ${className}`}
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
        className={`markdown-file-reference text-brand ${className}`}
        data-file-reference="true"
        title={fileReference.path}
      >
        {content}
      </span>
    );
  }

  return (
    <a
      className={`font-medium text-brand underline decoration-current/35 underline-offset-2 transition-colors hover:text-brand-strong ${className}`}
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
  promptFileReferences?: boolean;
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
  promptFileReferences = false,
  remarkPlugins,
  ...props
}: MessageResponseProps) {
  const parsedResponse = parseCodeComments(children ?? "");
  const normalizedMarkdown = normalizeMarkdownFileReferences(parsedResponse.markdown);
  const markdownComponents: Components = {
    ...components,
    a: MarkdownLink,
  };
  const resolvedRemarkPlugins = promptFileReferences
    ? [promptFileReferenceRemarkPlugin, ...(remarkPlugins ?? [])]
    : remarkPlugins;

  return (
    <MessageFileReferenceContext.Provider value={onOpenFileReference ?? null}>
      <Streamdown
        className={`size-full break-words [&_blockquote]:border-l-2 [&_blockquote]:border-separator [&_blockquote]:pl-3 [&_code]:font-mono [&_code]:text-body-small [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_pre]:overflow-x-auto [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`}
        controls={{ code: { copy: true, download: false }, mermaid: false, table: false }}
        {...props}
        BlockComponent={InteractiveMessageBlock}
        components={markdownComponents}
        {...(resolvedRemarkPlugins === undefined ? {} : { remarkPlugins: resolvedRemarkPlugins })}
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
    previousProps.onOpenFileReference === nextProps.onOpenFileReference &&
    previousProps.promptFileReferences === nextProps.promptFileReferences,
);

MessageResponse.displayName = "MessageResponse";

export default MessageResponse;
