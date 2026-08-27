import { BrainCircuitIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { useState, type HTMLAttributes } from "react";

export function Reasoning({ className = "", defaultOpen = false, isStreaming = false, ...props }: HTMLAttributes<HTMLDetailsElement> & Readonly<{ defaultOpen?: boolean; isStreaming?: boolean }>) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className={`ai-reasoning ${className}`} data-ai-element="reasoning" onToggle={(event) => setOpen(event.currentTarget.open)} open={open} {...props} data-streaming={isStreaming} />;
}

export function ReasoningTrigger({ children = "已处理", isStreaming = false }: Readonly<{ children?: string; isStreaming?: boolean }>) {
  return <summary className="ai-reasoning-trigger"><BrainCircuitIcon aria-hidden="true" /><span>{children}</span>{isStreaming ? <LoaderCircleIcon className="spin" aria-hidden="true" /> : null}<ChevronRightIcon aria-hidden="true" /></summary>;
}

export function ReasoningContent({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ai-reasoning-content ${className}`} {...props} />;
}
