import { ChevronRight } from "lucide-react";
import { createContext, useContext, useMemo, type HTMLAttributes, type ReactNode } from "react";

type PlanContextValue = Readonly<{
  isStreaming: boolean;
}>;

const PlanContext = createContext<PlanContextValue | null>(null);

export type PlanProps = HTMLAttributes<HTMLDetailsElement> & {
  defaultOpen?: boolean;
  isStreaming?: boolean;
  open?: boolean;
};

export function Plan({
  children,
  className = "",
  defaultOpen,
  isStreaming = false,
  open,
  ...props
}: PlanProps) {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming]);

  return (
    <PlanContext.Provider value={contextValue}>
      <details
        className={`group/plan w-full border-l-2 border-primary pl-3 ${className}`}
        data-ai-plan=""
        data-streaming={isStreaming}
        open={open ?? defaultOpen}
        {...props}
      >
        {children}
      </details>
    </PlanContext.Provider>
  );
}

export type PlanHeaderProps = HTMLAttributes<HTMLElement>;

export function PlanHeader({ className = "", ...props }: PlanHeaderProps) {
  return (
    <summary
      className={`flex min-h-10 cursor-pointer list-none items-center gap-3 py-1 text-foreground transition-colors hover:text-primary [&::-webkit-details-marker]:hidden ${className}`}
      {...props}
    />
  );
}

export type PlanTitleProps = Omit<HTMLAttributes<HTMLHeadingElement>, "children"> & {
  children: string;
};

export function PlanTitle({ children, className = "", ...props }: PlanTitleProps) {
  const context = useContext(PlanContext);

  return (
    <h3
      className={`text-body-small font-semibold ${context?.isStreaming === true ? "animate-pulse" : ""} ${className}`}
      {...props}
    >
      {children}
    </h3>
  );
}

export type PlanDescriptionProps = Omit<HTMLAttributes<HTMLParagraphElement>, "children"> & {
  children: string;
};

export function PlanDescription({ children, className = "", ...props }: PlanDescriptionProps) {
  const context = useContext(PlanContext);

  return (
    <p
      className={`mt-0.5 text-label text-muted-foreground ${context?.isStreaming === true ? "animate-pulse" : ""} ${className}`}
      {...props}
    >
      {children}
    </p>
  );
}

export type PlanTriggerProps = HTMLAttributes<HTMLSpanElement> & {
  children?: ReactNode;
};

export function PlanTrigger({ children, className = "", ...props }: PlanTriggerProps) {
  return (
    <span
      aria-hidden="true"
      className={`ml-auto inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground ${className}`}
      {...props}
    >
      {children ?? (
        <ChevronRight className="size-4 transition-transform group-open/plan:rotate-90" />
      )}
    </span>
  );
}

export type PlanContentProps = HTMLAttributes<HTMLDivElement>;

export function PlanContent({ className = "", ...props }: PlanContentProps) {
  return (
    <div
      className={`mb-2 overflow-x-auto border-t border-separator pt-2 font-mono text-meta leading-5 text-muted-foreground ${className}`}
      {...props}
    />
  );
}
