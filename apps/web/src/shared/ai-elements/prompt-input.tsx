import { ArrowUp, LoaderCircle, Paperclip, Plus, Square } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type SelectHTMLAttributes,
  type SubmitEvent,
  type TextareaHTMLAttributes,
} from "react";

import type { AttachmentData } from "./attachments.js";

export type PromptInputAttachment = AttachmentData & Readonly<{ file: File }>;

export type PromptInputMessage = Readonly<{
  files: readonly PromptInputAttachment[];
  text: string;
}>;

type PromptInputError = Readonly<{
  code: "file_too_large" | "invalid_file_type" | "too_many_files";
  message: string;
}>;

type PromptInputAttachmentsContextValue = Readonly<{
  clear: () => void;
  disabled: boolean;
  files: readonly PromptInputAttachment[];
  openFileDialog: () => void;
  remove: (id: string) => void;
}>;

const PromptInputAttachmentsContext = createContext<PromptInputAttachmentsContextValue | undefined>(
  undefined,
);

export function usePromptInputAttachments() {
  const context = useContext(PromptInputAttachmentsContext);
  if (context === undefined) {
    throw new Error("usePromptInputAttachments must be used inside PromptInput");
  }
  return context;
}

type PromptInputProps = Omit<FormHTMLAttributes<HTMLFormElement>, "onError" | "onSubmit"> & {
  accept?: string;
  disabled?: boolean;
  globalDrop?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  multiple?: boolean;
  onAttachmentsChange?: (files: readonly PromptInputAttachment[]) => void;
  onError?: (error: PromptInputError) => void;
  onSubmit?: (message: PromptInputMessage, event: SubmitEvent<HTMLFormElement>) => void;
};

function acceptsFile(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === "") {
    return true;
  }
  return accept.split(",").some((value) => {
    const rule = value.trim();
    return rule.endsWith("/*") ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule;
  });
}

function revokePreview(attachment: PromptInputAttachment) {
  if (attachment.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function PromptInput({
  accept,
  children,
  className = "",
  disabled = false,
  globalDrop = false,
  maxFiles = Number.POSITIVE_INFINITY,
  maxFileSize = Number.POSITIVE_INFINITY,
  multiple = false,
  onAttachmentsChange,
  onError,
  onPaste,
  onSubmit,
  ...props
}: PromptInputProps) {
  const [files, setFiles] = useState<PromptInputAttachment[]>([]);
  const filesRef = useRef(files);
  const inputRef = useRef<HTMLInputElement>(null);
  filesRef.current = files;

  const addFiles = useCallback(
    (incoming: readonly File[]) => {
      setFiles((current) => {
        if (disabled) {
          return current;
        }
        const accepted: PromptInputAttachment[] = [];
        const maximum = Math.min(maxFiles, multiple ? Number.POSITIVE_INFINITY : 1);
        const available = Math.max(0, maximum - current.length);
        let limitExceeded = false;

        // 逐个校验后再占用容量，避免一个非法文件挤掉后续合法文件。
        for (const file of incoming) {
          if (!acceptsFile(file, accept)) {
            onError?.({ code: "invalid_file_type", message: `${file.name} 的文件类型不受支持` });
            continue;
          }
          if (file.size > maxFileSize) {
            onError?.({ code: "file_too_large", message: `${file.name} 超过大小限制` });
            continue;
          }
          if (accepted.length >= available) {
            limitExceeded = true;
            continue;
          }
          accepted.push({
            file,
            id: globalThis.crypto.randomUUID(),
            mediaType: file.type,
            name: file.name,
            previewUrl: URL.createObjectURL(file),
            size: file.size,
          });
        }
        if (limitExceeded) {
          onError?.({ code: "too_many_files", message: `最多添加 ${String(maximum)} 个附件` });
        }
        return [...current, ...accepted];
      });
    },
    [accept, disabled, maxFileSize, maxFiles, multiple, onError],
  );

  const clear = useCallback(() => {
    setFiles((current) => {
      current.forEach(revokePreview);
      return [];
    });
    if (inputRef.current !== null) {
      inputRef.current.value = "";
    }
  }, []);

  const remove = useCallback((id: string) => {
    setFiles((current) => {
      const removed = current.find((file) => file.id === id);
      if (removed !== undefined) {
        revokePreview(removed);
      }
      return current.filter((file) => file.id !== id);
    });
  }, []);

  useEffect(
    () => () => {
      filesRef.current.forEach(revokePreview);
    },
    [],
  );

  useEffect(() => {
    onAttachmentsChange?.(files);
  }, [files, onAttachmentsChange]);

  useEffect(() => {
    if (!globalDrop || disabled) {
      return undefined;
    }
    const prevent = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files") === true) {
        event.preventDefault();
      }
    };
    const drop = (event: DragEvent) => {
      if (event.dataTransfer?.files.length) {
        event.preventDefault();
        addFiles([...event.dataTransfer.files]);
      }
    };
    document.addEventListener("dragover", prevent);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", prevent);
      document.removeEventListener("drop", drop);
    };
  }, [addFiles, disabled, globalDrop]);

  const context = useMemo<PromptInputAttachmentsContextValue>(
    () => ({
      clear,
      disabled,
      files,
      openFileDialog: () => {
        if (!disabled) {
          inputRef.current?.click();
        }
      },
      remove,
    }),
    [clear, disabled, files, remove],
  );

  return (
    <PromptInputAttachmentsContext.Provider value={context}>
      <form
        {...props}
        aria-disabled={disabled || undefined}
        className={`overflow-hidden rounded-surface border border-transparent bg-raised shadow-floating transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-focus ${className}`}
        onPaste={(event) => {
          onPaste?.(event);
          if (disabled || event.defaultPrevented) {
            return;
          }
          const pastedFiles = [...event.clipboardData.files];
          if (pastedFiles.length > 0) {
            addFiles(pastedFiles);
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const value = formData.get("message");
          onSubmit?.({ files, text: typeof value === "string" ? value : "" }, event);
        }}
      >
        <input
          accept={accept}
          className="sr-only"
          disabled={disabled}
          multiple={multiple}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            addFiles([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
        {children}
      </form>
    </PromptInputAttachmentsContext.Provider>
  );
}

type PromptInputSectionProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputBody({ className = "", ...props }: PromptInputSectionProps) {
  return <div className={`px-3 pt-2 ${className}`} {...props} />;
}

export function PromptInputHeader({ className = "", ...props }: PromptInputSectionProps) {
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
  name = "message",
  onKeyDown,
  rows = 2,
  ...props
}: PromptInputTextareaProps) {
  return (
    <textarea
      className={`max-h-40 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed ${className}`}
      name={name}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        if (
          !event.defaultPrevented &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
      rows={rows}
      {...props}
    />
  );
}

type PromptInputActionAddAttachmentsProps = PromptInputButtonProps & { label?: string };

export function PromptInputActionAddAttachments({
  children,
  label = "添加附件",
  onClick,
  ...props
}: PromptInputActionAddAttachmentsProps) {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      {...props}
      aria-label={label}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          attachments.openFileDialog();
        }
      }}
      title={label}
    >
      {children ?? <Paperclip className="size-3.5" aria-hidden="true" />}
    </PromptInputButton>
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
      className={`h-7 w-auto max-w-40 appearance-none rounded-control border-0 bg-transparent px-1.5 text-label text-muted-foreground outline-none [field-sizing:content] hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      {...props}
    />
  );
}

type PromptInputSubmitProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  status: "failed" | "idle" | "reconnecting" | "running" | "submitting";
};

export function PromptInputSubmit({
  children,
  className = "",
  status,
  type = "submit",
  ...props
}: PromptInputSubmitProps) {
  const pending = status === "reconnecting" || status === "submitting";

  return (
    <button
      className={`grid size-8 shrink-0 place-items-center rounded-pill bg-foreground text-raised transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-control-active disabled:text-muted-foreground ${className}`}
      type={type}
      {...props}
    >
      {children ??
        (status === "running" ? (
          <Square className="size-3.5 fill-current" aria-hidden="true" />
        ) : pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUp className="size-4" aria-hidden="true" />
        ))}
    </button>
  );
}
