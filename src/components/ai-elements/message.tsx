import { CheckIcon, CopyIcon } from "lucide-react";
import { useState, type HTMLAttributes } from "react";

export type MessageProps = HTMLAttributes<HTMLElement> & Readonly<{ from: "assistant" | "system" | "user" }>;

export function Message({ className = "", from, ...props }: MessageProps) {
  return <article className={`ai-message ai-message--${from} ${className}`} data-ai-element="message" data-role={from} {...props} />;
}

export function MessageContent({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ai-message-content ${className}`} data-ai-element="message-content" {...props} />;
}

export function MessageHeader({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={`ai-message-header ${className}`} {...props} />;
}

export function MessageMeta({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`ai-message-meta ${className}`} {...props} />;
}

export function MessageCopyButton({ text }: Readonly<{ text: string }>) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return <button aria-label={copied ? "已复制" : "复制消息"} className="ai-message-copy" onClick={() => void copy()} title={copied ? "已复制" : "复制消息"} type="button">{copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}</button>;
}
