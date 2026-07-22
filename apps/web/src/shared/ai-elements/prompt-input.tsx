import { ArrowUp, LoaderCircle, Plus } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  HTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type PromptInputProps = FormHTMLAttributes<HTMLFormElement>;

export function PromptInput({ className = "", ...props }: PromptInputProps) {
  return (
    <form
      className={`overflow-hidden rounded-surface bg-raised shadow-floating transition-shadow focus-within:shadow-focus ${className}`}
      {...props}
    />
  );
}

type PromptInputSectionProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputBody({ className = "", ...props }: PromptInputSectionProps) {
  return <div className={`px-3 pt-2 ${className}`} {...props} />;
}

export function PromptInputFooter({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`flex min-h-10 items-center justify-between gap-2 px-2 pb-2 ${className}`}
      {...props}
    />
  );
}

export function PromptInputTools({ className = "", ...props }: PromptInputSectionProps) {
  return <div className={`flex min-w-0 items-center gap-1 ${className}`} {...props} />;
}

type PromptInputTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function PromptInputTextarea({
  className = "",
  rows = 2,
  ...props
}: PromptInputTextareaProps) {
  return (
    <textarea
      className={`max-h-40 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed ${className}`}
      rows={rows}
      {...props}
    />
  );
}

type PromptInputButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function PromptInputButton({
  children,
  className = "",
  type = "button",
  ...props
}: PromptInputButtonProps) {
  return (
    <button
      className={`inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-label text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      type={type}
      {...props}
    >
      {children ?? <Plus className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

type PromptInputSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function PromptInputSelect({ className = "", ...props }: PromptInputSelectProps) {
  return (
    <select
      className={`h-7 max-w-40 rounded-control border-0 bg-transparent px-1.5 text-label text-muted-foreground outline-none hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      {...props}
    />
  );
}

type PromptInputSubmitProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  status: "error" | "ready" | "streaming" | "submitted";
};

export function PromptInputSubmit({
  children,
  className = "",
  status,
  type = "submit",
  ...props
}: PromptInputSubmitProps) {
  const pending = status === "streaming" || status === "submitted";

  return (
    <button
      className={`grid size-8 shrink-0 place-items-center rounded-pill bg-foreground text-raised transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-control-active disabled:text-muted-foreground ${className}`}
      type={type}
      {...props}
    >
      {children ??
        (pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUp className="size-4" aria-hidden="true" />
        ))}
    </button>
  );
}
