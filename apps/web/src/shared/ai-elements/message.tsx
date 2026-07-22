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
      className={`max-w-full text-[14px] leading-6 text-foreground group-data-[role=user]/message:max-w-[90%] group-data-[role=user]/message:rounded-[7px] group-data-[role=user]/message:bg-surface-muted group-data-[role=user]/message:px-3.5 group-data-[role=user]/message:py-2.5 ${className}`}
      {...props}
    />
  );
}

export function MessageResponse({ className = "", ...props }: MessageContentProps) {
  return (
    <div
      className={`space-y-3 whitespace-pre-wrap break-words [&_code]:rounded-[4px] [&_code]:bg-surface-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.92em] [&_p]:m-0 ${className}`}
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
      className={`grid size-7 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground ${className}`}
      title={label}
      type={type}
      {...props}
    />
  );
}
