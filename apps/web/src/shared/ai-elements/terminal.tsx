import * as AnsiModule from "ansi-to-react";
import { Check, Copy } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type HTMLAttributes,
} from "react";

import { useTranslation } from "../../i18n/i18n.js";

type AnsiComponent = ComponentType<Readonly<{ children?: string; className?: string }>>;

const ansiDefault = AnsiModule.default as AnsiComponent | { default: AnsiComponent };
const Ansi = typeof ansiDefault === "function" ? ansiDefault : ansiDefault.default;

type TerminalContextValue = Readonly<{
  autoScroll: boolean;
  isStreaming: boolean;
  output: string;
}>;

const TerminalContext = createContext<TerminalContextValue | null>(null);

function useTerminalContext(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (context === null) {
    throw new Error("Terminal components must be rendered inside Terminal");
  }
  return context;
}

export type TerminalProps = HTMLAttributes<HTMLDivElement> & {
  autoScroll?: boolean;
  isStreaming?: boolean;
  output: string;
};

export function Terminal({
  autoScroll = true,
  children,
  className = "",
  isStreaming = false,
  output,
  ...props
}: TerminalProps) {
  const contextValue = useMemo(
    () => ({ autoScroll, isStreaming, output }),
    [autoScroll, isStreaming, output],
  );

  return (
    <TerminalContext.Provider value={contextValue}>
      <div
        className={`mb-2 overflow-hidden rounded-control bg-raised text-foreground shadow-sm ${className}`}
        data-streaming={isStreaming}
        data-terminal=""
        {...props}
      >
        {children}
      </div>
    </TerminalContext.Provider>
  );
}

export type TerminalHeaderProps = HTMLAttributes<HTMLDivElement>;

export function TerminalHeader({ className = "", ...props }: TerminalHeaderProps) {
  return (
    <div
      className={`flex min-h-8 items-center border-b border-separator px-2.5 ${className}`}
      {...props}
    />
  );
}

export type TerminalTitleProps = HTMLAttributes<HTMLDivElement>;

export function TerminalTitle({ className = "", ...props }: TerminalTitleProps) {
  return <div className={`text-meta font-medium text-muted-foreground ${className}`} {...props} />;
}

export type TerminalActionsProps = HTMLAttributes<HTMLDivElement>;

export function TerminalActions({ className = "", ...props }: TerminalActionsProps) {
  return <div className={`ml-auto flex items-center ${className}`} {...props} />;
}

export type TerminalCopyButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onError"> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function TerminalCopyButton({
  className = "",
  onClick,
  onCopy,
  onError,
  timeout = 2_000,
  ...props
}: TerminalCopyButtonProps) {
  const { output } = useTerminalContext();
  const { t } = useTranslation("conversation");
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copyOutput = async () => {
    try {
      // 历史输出只允许复制，不提供清空或编辑入口。
      await navigator.clipboard.writeText(output);
      setCopied(true);
      onCopy?.();
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error("Unable to copy terminal output"));
    }
  };

  return (
    <button
      aria-label={copied ? t("aiElements.copiedOutput") : t("aiElements.copyOutput")}
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          void copyOutput();
        }
      }}
      title={copied ? t("aiElements.copied") : t("aiElements.copyOutput")}
      type="button"
      {...props}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>;

export function TerminalContent({ children, className = "", ...props }: TerminalContentProps) {
  const { autoScroll, isStreaming, output } = useTerminalContext();
  const { t } = useTranslation("conversation");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const content = contentRef.current;
    if (content !== null) {
      // 每次增量输出后跟随到底部，避免流式日志停留在旧位置。
      content.scrollTop = content.scrollHeight;
    }
  }, [autoScroll, output]);

  return (
    <div
      aria-busy={isStreaming}
      aria-live={isStreaming ? "polite" : "off"}
      className={`max-h-72 overflow-auto px-3 py-2 font-mono text-meta leading-5 ${className}`}
      ref={contentRef}
      {...props}
    >
      <Ansi className="block whitespace-pre-wrap break-words">{output}</Ansi>
      {isStreaming ? (
        <span
          aria-label={t("aiElements.streamingOutput")}
          className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground align-middle"
          role="status"
        />
      ) : null}
      {children}
    </div>
  );
}
