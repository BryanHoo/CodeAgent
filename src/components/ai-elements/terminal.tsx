import Anser from "anser";
import { CheckIcon, CopyIcon, TerminalIcon } from "lucide-react";
import { useMemo, useState, type CSSProperties, type HTMLAttributes } from "react";

function toStyle(entry: Anser.AnserJsonEntry): CSSProperties {
  const decorations = new Set(entry.decorations);
  const style: CSSProperties = {};
  if (entry.fg_truecolor || entry.fg) style.color = `rgb(${entry.fg_truecolor || entry.fg})`;
  if (entry.bg_truecolor || entry.bg) style.backgroundColor = `rgb(${entry.bg_truecolor || entry.bg})`;
  if (decorations.has("bold")) style.fontWeight = 700;
  if (decorations.has("italic")) style.fontStyle = "italic";
  if (decorations.has("underline")) style.textDecoration = "underline";
  if (decorations.has("dim")) style.opacity = 0.55;
  return style;
}

export function Terminal({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ai-terminal ${className}`} data-ai-element="terminal" {...props} />;
}

export function TerminalHeader({ command, ...props }: HTMLAttributes<HTMLDivElement> & Readonly<{ command: string }>) {
  const [copied, setCopied] = useState(false);
  return <div className="ai-terminal-header" {...props}><TerminalIcon aria-hidden="true" /><code>{command}</code><button aria-label="复制终端输出" onClick={() => { void navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); }} type="button">{copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}</button></div>;
}

export function TerminalContent({ output }: Readonly<{ output: string }>) {
  const entries = useMemo(() => Anser.ansiToJson(output, { remove_empty: true }), [output]);
  return <pre className="ai-terminal-content">{entries.map((entry, index) => { const style = toStyle(entry); return Object.keys(style).length === 0 ? entry.content : <span key={`${String(index)}:${entry.content.length}`} style={style}>{entry.content}</span>; })}</pre>;
}
