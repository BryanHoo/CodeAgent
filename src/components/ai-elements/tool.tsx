import { CheckCircleIcon, ChevronRightIcon, CircleDashedIcon, CircleXIcon, ClockIcon, WrenchIcon } from "lucide-react";
import { createContext, useContext, useState, type HTMLAttributes, type ReactNode } from "react";

export type ToolState = "approval-requested" | "input-available" | "output-available" | "output-error";
const ToolOpenContext = createContext<boolean | null>(null);

export function Tool({ className = "", defaultOpen = false, onToggle, ...props }: HTMLAttributes<HTMLDetailsElement> & Readonly<{ defaultOpen?: boolean }>) {
  const [open, setOpen] = useState(defaultOpen);
  return <ToolOpenContext.Provider value={open}><details className={`ai-tool ${className}`} data-ai-element="tool" onToggle={(event) => { onToggle?.(event); setOpen(event.currentTarget.open); }} open={open} {...props} /></ToolOpenContext.Provider>;
}

const statusPresentation = {
  "approval-requested": { icon: ClockIcon, label: "等待审批", tone: "waiting" },
  "input-available": { icon: CircleDashedIcon, label: "运行中", tone: "running" },
  "output-available": { icon: CheckCircleIcon, label: "已完成", tone: "completed" },
  "output-error": { icon: CircleXIcon, label: "失败", tone: "failed" },
} as const;

export function ToolHeader({ className = "", state, title, ...props }: HTMLAttributes<HTMLElement> & Readonly<{ state: ToolState; title: string }>) {
  const presentation = statusPresentation[state];
  const StatusIcon = presentation.icon;
  return <summary className={`ai-tool-header ${className}`} {...props}><WrenchIcon aria-hidden="true" /><span>{title}</span><small data-tone={presentation.tone}><StatusIcon aria-hidden="true" />{presentation.label}</small><ChevronRightIcon aria-hidden="true" /></summary>;
}

export function ToolContent({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  const open = useContext(ToolOpenContext);
  return open === false ? null : <div className={`ai-tool-content ${className}`} {...props}>{children}</div>;
}

export function ToolInput({ input }: Readonly<{ input: unknown }>) {
  return <div className="ai-tool-section"><strong>输入</strong><pre>{stringify(input)}</pre></div>;
}

export function ToolOutput({ error, output }: Readonly<{ error?: string; output: ReactNode }>) {
  return <div className={error === undefined ? "ai-tool-section" : "ai-tool-section error"}><strong>{error === undefined ? "结果" : "错误"}</strong>{error === undefined ? output : <pre>{error}</pre>}</div>;
}

function stringify(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
