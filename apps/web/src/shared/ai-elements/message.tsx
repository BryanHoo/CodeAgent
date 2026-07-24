import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type HTMLAttributes,
  type ReactElement,
} from "react";
import { Streamdown, type Components } from "streamdown";

import { CodeComments, parseCodeComments } from "./code-comments.js";

type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
};

type FileReferenceMetadata = Readonly<{
  lineNumber: string | null;
  path: string;
}>;

export type MessageFileReference = Readonly<{
  lineNumber: number | null;
  path: string;
}>;

const MessageFileReferenceContext = createContext<
  ((reference: MessageFileReference) => void) | null
>(null);

// Agent 输出使用“绝对路径:行号”表达文件定位；渲染时拆出行号，避免把路径暴露给用户。
const LOCAL_FILE_REFERENCE_PATTERN = /^(?<path>\/.+?\.[a-z0-9]+?)(?::(?<line>\d+)(?::\d+)?)?$/i;

function getFileReferenceMetadata(href: string | undefined): FileReferenceMetadata | null {
  if (href === undefined) {
    return null;
  }

  const match = LOCAL_FILE_REFERENCE_PATTERN.exec(href);
  const matchedGroups = match?.groups;
  if (matchedGroups === undefined) {
    return null;
  }

  const filePath = matchedGroups["path"];
  if (filePath === undefined) {
    return null;
  }

  return {
    lineNumber: matchedGroups["line"] ?? null,
    path: filePath,
  };
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
        <button
          className={`markdown-file-reference cursor-pointer text-accent underline decoration-transparent underline-offset-2 transition-colors hover:text-accent-strong hover:decoration-current ${className}`}
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
        </button>
      );
    }

    return (
      <span
        className={`markdown-file-reference text-accent ${className}`}
        data-file-reference="true"
        title={fileReference.path}
      >
        {content}
      </span>
    );
  }

  return (
    <a
      className={`font-medium text-accent underline decoration-current/35 underline-offset-2 transition-colors hover:text-accent-strong ${className}`}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  );
}

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "assistant" | "system" | "user";
};

export function Message({ className = "", from, ...props }: MessageProps) {
  return (
    <article
      className={`group/message flex w-full flex-col ${
        from === "user" ? "items-end" : "items-start"
      } ${className}`}
      data-role={from}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ className = "", ...props }: MessageContentProps) {
  return (
    <div
      className={`max-w-full text-body leading-6 text-foreground group-data-[role=user]/message:max-w-[var(--ui-layout-message-width)] group-data-[role=user]/message:rounded-surface group-data-[role=user]/message:bg-control group-data-[role=user]/message:px-3.5 group-data-[role=user]/message:py-2.5 ${className}`}
      {...props}
    />
  );
}

export type MessageActionsProps = ComponentProps<"div">;

export function MessageActions({ className = "", ...props }: MessageActionsProps) {
  return <div className={`flex items-center gap-1 ${className}`} {...props} />;
}

export type MessageActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
  tooltip?: string;
};

export function MessageAction({
  className = "",
  label,
  tooltip,
  type = "button",
  ...props
}: MessageActionProps) {
  const accessibleLabel = label ?? tooltip;

  return (
    <button
      aria-label={accessibleLabel}
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      title={tooltip}
      type={type}
      {...props}
    />
  );
}

type MessageBranchContextValue = Readonly<{
  branches: ReactElement[];
  currentBranch: number;
  goToNext: () => void;
  goToPrevious: () => void;
  setBranches: (branches: ReactElement[]) => void;
  totalBranches: number;
}>;

const MessageBranchContext = createContext<MessageBranchContextValue | null>(null);

function useMessageBranch(): MessageBranchContextValue {
  const context = useContext(MessageBranchContext);

  if (context === null) {
    throw new Error("MessageBranch components must be used within MessageBranch");
  }

  return context;
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export function MessageBranch({
  className = "",
  defaultBranch = 0,
  onBranchChange,
  ...props
}: MessageBranchProps) {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (nextBranch: number) => {
      setCurrentBranch(nextBranch);
      onBranchChange?.(nextBranch);
    },
    [onBranchChange],
  );

  const goToPrevious = useCallback(() => {
    const previousBranch = currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(previousBranch);
  }, [branches.length, currentBranch, handleBranchChange]);

  const goToNext = useCallback(() => {
    const nextBranch = currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(nextBranch);
  }, [branches.length, currentBranch, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextValue>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious],
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div className={`grid w-full gap-2 [&>div]:pb-0 ${className}`} {...props} />
    </MessageBranchContext.Provider>
  );
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageBranchContent({ children, ...props }: MessageBranchContentProps) {
  const { branches, currentBranch, setBranches } = useMessageBranch();
  const branchElements = useMemo(
    () => (Array.isArray(children) ? children : [children]) as ReactElement[],
    [children],
  );

  useEffect(() => {
    // 分支内容由调用方声明，只有数量变化时才同步选择器需要的元数据。
    if (branches.length !== branchElements.length) {
      setBranches(branchElements);
    }
  }, [branchElements, branches.length, setBranches]);

  return branchElements.map((branch, branchIndex) => (
    <div
      className={`grid gap-2 overflow-hidden [&>div]:pb-0 ${
        branchIndex === currentBranch ? "block" : "hidden"
      }`}
      key={branch.key ?? branchIndex}
      {...props}
    >
      {branch}
    </div>
  ));
}

export type MessageBranchSelectorProps = HTMLAttributes<HTMLDivElement>;

export function MessageBranchSelector({ className = "", ...props }: MessageBranchSelectorProps) {
  const { totalBranches } = useMessageBranch();

  if (totalBranches <= 1) {
    return null;
  }

  return <div className={`flex items-center gap-0.5 ${className}`} {...props} />;
}

export type MessageBranchPreviousProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function MessageBranchPrevious({
  children,
  className = "",
  ...props
}: MessageBranchPreviousProps) {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <button
      aria-label="上一个回复分支"
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 ${className}`}
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      type="button"
      {...props}
    >
      {children ?? <ChevronLeft className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

export type MessageBranchNextProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function MessageBranchNext({ children, className = "", ...props }: MessageBranchNextProps) {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <button
      aria-label="下一个回复分支"
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 ${className}`}
      disabled={totalBranches <= 1}
      onClick={goToNext}
      type="button"
      {...props}
    >
      {children ?? <ChevronRight className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export function MessageBranchPage({ className = "", ...props }: MessageBranchPageProps) {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <span className={`px-1 text-label text-muted-foreground ${className}`} {...props}>
      {currentBranch + 1} / {totalBranches}
    </span>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  onOpenFileReference?: (reference: MessageFileReference) => void;
};

function MessageResponseContent({
  children,
  className = "",
  components,
  onOpenFileReference,
  ...props
}: MessageResponseProps) {
  const parsedResponse = parseCodeComments(children ?? "");
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
        components={markdownComponents}
      >
        {parsedResponse.markdown}
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
    previousProps.onOpenFileReference === nextProps.onOpenFileReference,
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export function MessageToolbar({ className = "", ...props }: MessageToolbarProps) {
  return (
    <div
      className={`mt-4 flex w-full items-center justify-between gap-4 ${className}`}
      {...props}
    />
  );
}
