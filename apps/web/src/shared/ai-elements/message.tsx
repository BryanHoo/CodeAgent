import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "assistant" | "system" | "user";
};

export function Message({ className = "", from, ...props }: MessageProps) {
  return (
    <article
      className={`group/message flex w-full flex-col ${
        from === "user" ? "items-end" : "items-start"
      } ${className}`}
      data-role={from}
      {...props}
    />
  );
}

type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ className = "", ...props }: MessageContentProps) {
  return (
    <div
      className={`max-w-full text-body leading-6 text-foreground group-data-[role=user]/message:max-w-[var(--ui-layout-message-width)] group-data-[role=user]/message:rounded-surface group-data-[role=user]/message:bg-control group-data-[role=user]/message:px-3.5 group-data-[role=user]/message:py-2.5 ${className}`}
      {...props}
    />
  );
}

export function MessageResponse({ className = "", ...props }: MessageContentProps) {
  return (
    <div
      className={`space-y-3 whitespace-pre-wrap break-words [&_code]:rounded-control [&_code]:bg-control [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-body-small [&_p]:m-0 ${className}`}
      {...props}
    />
  );
}

export function MessageActions({ className = "", ...props }: MessageContentProps) {
  return <div className={`mt-2 flex items-center gap-1 ${className}`} {...props} />;
}

type MessageActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

export function MessageAction({
  className = "",
  label,
  type = "button",
  ...props
}: MessageActionProps) {
  return (
    <button
      aria-label={label}
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      title={label}
      type={type}
      {...props}
    />
  );
}
