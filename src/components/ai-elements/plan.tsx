import { CheckIcon, ChevronsUpDownIcon, CircleIcon, LoaderCircleIcon } from "lucide-react";
import { type HTMLAttributes, type ReactNode } from "react";

export function Plan({ className = "", defaultOpen = false, ...props }: HTMLAttributes<HTMLDetailsElement> & Readonly<{ defaultOpen?: boolean }>) {
  return <details className={`ai-plan ${className}`} data-ai-element="plan" open={defaultOpen} {...props} />;
}

export function PlanHeader({ children, title, ...props }: HTMLAttributes<HTMLElement> & Readonly<{ title: string }>) {
  return <summary className="ai-plan-header" {...props}><span><strong>{title}</strong>{children}</span><ChevronsUpDownIcon aria-hidden="true" /></summary>;
}

export function PlanContent({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ai-plan-content ${className}`} {...props} />;
}

export function PlanItem({ children, status }: Readonly<{ children?: ReactNode; status: "completed" | "in-progress" | "pending" }>) {
  const Icon = status === "completed" ? CheckIcon : status === "in-progress" ? LoaderCircleIcon : CircleIcon;
  return <div className="ai-plan-item" data-status={status}><Icon aria-hidden="true" /><span>{children}</span></div>;
}
