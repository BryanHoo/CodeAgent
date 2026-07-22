import { Brain, ChevronRight } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

type ReasoningProps = HTMLAttributes<HTMLDetailsElement> & {
  defaultOpen?: boolean;
};

export function Reasoning({ className = "", defaultOpen, ...props }: ReasoningProps) {
  return (
    <details
      className={`group/reasoning w-full border-l border-border pl-4 ${className}`}
      open={defaultOpen}
      {...props}
    />
  );
}

type ReasoningTriggerProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function ReasoningTrigger({ children, className = "", ...props }: ReasoningTriggerProps) {
  return (
    <summary
      className={`flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden ${className}`}
      {...props}
    >
      <Brain className="size-3.5" aria-hidden="true" />
      <span>{children}</span>
      <ChevronRight
        className="ml-auto size-3.5 transition-transform group-open/reasoning:rotate-90"
        aria-hidden="true"
      />
    </summary>
  );
}

type ReasoningContentProps = HTMLAttributes<HTMLDivElement>;

export function ReasoningContent({ className = "", ...props }: ReasoningContentProps) {
  return (
    <div className={`pb-2 pt-1 text-xs leading-5 text-muted-foreground ${className}`} {...props} />
  );
}
