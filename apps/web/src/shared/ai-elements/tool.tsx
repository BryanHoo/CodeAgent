import {
  CheckCircle,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleX,
  Clock,
  Wrench,
} from "lucide-react";
import { isValidElement, type HTMLAttributes, type ReactNode } from "react";

import { CodeBlock } from "./code-block.js";

export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

type ToolProps = HTMLAttributes<HTMLDetailsElement> & {
  defaultOpen?: boolean;
};

export function Tool({ className = "", defaultOpen, ...props }: ToolProps) {
  return (
    <details
      className={`group/tool w-full rounded-surface bg-control px-3 py-1 ${className}`}
      open={defaultOpen}
      {...props}
    />
  );
}

const statusPresentation: Record<ToolState, { icon: ReactNode; label: string }> = {
  "approval-requested": {
    icon: <Clock className="size-3.5 text-warning" aria-hidden="true" />,
    label: "等待批准",
  },
  "approval-responded": {
    icon: <CheckCircle className="size-3.5 text-accent" aria-hidden="true" />,
    label: "已响应",
  },
  "input-available": {
    icon: <CircleDashed className="size-3.5 animate-spin" aria-hidden="true" />,
    label: "运行中",
  },
  "input-streaming": {
    icon: <Circle className="size-3.5" aria-hidden="true" />,
    label: "等待中",
  },
  "output-available": {
    icon: <CheckCircle className="size-3.5" aria-hidden="true" />,
    label: "已完成",
  },
  "output-denied": {
    icon: <CircleX className="size-3.5 text-warning" aria-hidden="true" />,
    label: "已拒绝",
  },
  "output-error": {
    icon: <CircleX className="size-3.5 text-danger" aria-hidden="true" />,
    label: "失败",
  },
};

type ToolHeaderProps = HTMLAttributes<HTMLElement> & {
  state: ToolState;
  title: string;
};

export function ToolHeader({ className = "", state, title, ...props }: ToolHeaderProps) {
  const presentation = statusPresentation[state];

  return (
    <summary
      className={`flex min-h-9 cursor-pointer list-none items-center gap-2 text-label text-foreground [&::-webkit-details-marker]:hidden ${className}`}
      {...props}
    >
      <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      <span
        className={`inline-flex items-center gap-1 ${
          state === "output-error" ? "text-danger" : "text-muted-foreground"
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
      className={`mb-2 space-y-4 rounded-control bg-raised px-3 py-3 text-muted-foreground shadow-sm ${className}`}
      {...props}
    />
  );
}

function formatJsonValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // 工具边界允许 unknown；不可序列化时仍保留可读的兜底文本。
    return String(value);
  }
}

export type ToolInputProps = HTMLAttributes<HTMLDivElement> & {
  input: unknown;
};

export function ToolInput({ className = "", input, ...props }: ToolInputProps) {
  return (
    <div className={`space-y-2 overflow-hidden ${className}`} {...props}>
      <h4 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">参数</h4>
      <CodeBlock code={formatJsonValue(input)} language="json" />
    </div>
  );
}

export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
  errorText: string | undefined;
  output: unknown;
};

export function ToolOutput({ className = "", errorText, output, ...props }: ToolOutputProps) {
  if (output === undefined && errorText === undefined) {
    return null;
  }

  const renderedOutput = isValidElement(output) ? (
    output
  ) : output === undefined ? null : (
    <CodeBlock code={formatJsonValue(output)} language="json" />
  );

  return (
    <div className={`space-y-2 ${className}`} {...props}>
      <h4
        className={`text-meta font-medium uppercase tracking-wide ${
          errorText === undefined ? "text-muted-foreground" : "text-danger"
        }`}
      >
        {errorText === undefined ? "结果" : "错误"}
      </h4>
      <div
        className={`overflow-x-auto rounded-surface text-meta [&_table]:w-full ${
          errorText === undefined ? "text-foreground" : "bg-danger/10 p-3 text-danger"
        }`}
      >
        {errorText === undefined ? null : <div className="whitespace-pre-wrap">{errorText}</div>}
        {renderedOutput}
      </div>
    </div>
  );
}
