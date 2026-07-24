import { Brain, ChevronRight } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";

type ReasoningContextValue = Readonly<{
  isOpen: boolean;
  isStreaming: boolean;
}>;

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export type ReasoningProps = HTMLAttributes<HTMLDetailsElement> & {
  collapsible?: boolean;
  defaultOpen?: boolean;
  isStreaming?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export const Reasoning = memo(function Reasoning({
  children,
  className = "",
  collapsible = true,
  defaultOpen,
  isStreaming = false,
  onOpenChange,
  open,
  ...props
}: ReasoningProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? isStreaming);
  const hasStreamedRef = useRef(isStreaming);
  const isOpen = open ?? uncontrolledOpen;

  useEffect(() => {
    if (isStreaming) {
      hasStreamedRef.current = true;
      if (defaultOpen !== false) {
        setUncontrolledOpen(true);
      }
      return;
    }

    if (hasStreamedRef.current) {
      // 与官方 AI Elements 行为一致：推理结束后自动收起，减少历史时间线噪音。
      const closeTimer = window.setTimeout(() => {
        setUncontrolledOpen(false);
      }, 1_000);
      return () => {
        window.clearTimeout(closeTimer);
      };
    }
  }, [defaultOpen, isStreaming]);

  const contextValue = useMemo(() => ({ isOpen, isStreaming }), [isOpen, isStreaming]);

  if (!collapsible) {
    return (
      <ReasoningContext.Provider value={contextValue}>
        <div className={`w-full ${className}`}>{children}</div>
      </ReasoningContext.Provider>
    );
  }

  return (
    <ReasoningContext.Provider value={contextValue}>
      <details
        className={`group/reasoning w-full ${className}`}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          if (open === undefined) {
            setUncontrolledOpen(nextOpen);
          }
          onOpenChange?.(nextOpen);
        }}
        open={isOpen}
        {...props}
      >
        {children}
      </details>
    </ReasoningContext.Provider>
  );
});

export type ReasoningTriggerProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  expandable?: boolean;
};

export function ReasoningTrigger({
  children,
  className = "",
  expandable = true,
  ...props
}: ReasoningTriggerProps) {
  const context = useContext(ReasoningContext);
  const content = (
    <>
      <Brain
        className={`size-3.5 shrink-0 ${context?.isStreaming === true ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {expandable ? (
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-open/reasoning:rotate-90"
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  if (!expandable) {
    return (
      <div
        className={`flex min-h-8 items-center gap-2 text-body-small text-muted-foreground ${className}`}
        {...props}
      >
        {content}
      </div>
    );
  }

  return (
    <summary
      className={`flex min-h-8 cursor-pointer list-none items-center gap-2 text-body-small text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden ${className}`}
      {...props}
    >
      {content}
    </summary>
  );
}

export type ReasoningContentProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: string;
};

export const ReasoningContent = memo(function ReasoningContent({
  children,
  className = "",
  ...props
}: ReasoningContentProps) {
  return children.trim().length === 0 ? null : (
    <div
      className={`ml-1.5 mt-1 border-l border-separator py-1 pl-5 text-body-small leading-6 text-muted-foreground ${className}`}
      {...props}
    >
      <Streamdown controls={false}>{children}</Streamdown>
    </div>
  );
});

Reasoning.displayName = "Reasoning";
ReasoningContent.displayName = "ReasoningContent";
