import { Check, ChevronRight, CircleDashed, CircleX, Wrench } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

export type ToolStatus = "completed" | "failed" | "running";

type ToolProps = HTMLAttributes<HTMLDetailsElement> & {
  defaultOpen?: boolean;
};

export function Tool({ className = "", defaultOpen, ...props }: ToolProps) {
  return (
    <details
      className={`group/tool w-full border-y border-border/80 py-1 ${className}`}
      open={defaultOpen}
      {...props}
    />
  );
}

const statusPresentation: Record<ToolStatus, { icon: ReactNode; label: string }> = {
  completed: { icon: <Check className="size-3.5" aria-hidden="true" />, label: "已完成" },
  failed: { icon: <CircleX className="size-3.5" aria-hidden="true" />, label: "失败" },
  running: {
    icon: <CircleDashed className="size-3.5 animate-spin" aria-hidden="true" />,
    label: "运行中",
  },
};

type ToolHeaderProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  status: ToolStatus;
};

export function ToolHeader({ children, className = "", status, ...props }: ToolHeaderProps) {
  const presentation = statusPresentation[status];

  return (
    <summary
      className={`flex min-h-9 cursor-pointer list-none items-center gap-2 text-xs text-foreground [&::-webkit-details-marker]:hidden ${className}`}
      {...props}
    >
      <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium">{children}</span>
      <span
        className={`inline-flex items-center gap-1 ${
          status === "failed" ? "text-danger" : "text-muted-foreground"
        }`}
      >
        {presentation.icon}
        {presentation.label}
      </span>
      <ChevronRight
        className="size-3.5 text-muted-foreground transition-transform group-open/tool:rotate-90"
        aria-hidden="true"
      />
    </summary>
  );
}

type ToolContentProps = HTMLAttributes<HTMLDivElement>;

export function ToolContent({ className = "", ...props }: ToolContentProps) {
  return (
    <div
      className={`mb-2 overflow-x-auto rounded-[5px] bg-surface-muted px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground ${className}`}
      {...props}
    />
  );
}
