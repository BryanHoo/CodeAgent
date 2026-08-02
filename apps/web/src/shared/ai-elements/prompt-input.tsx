import { ArrowUp, FilePlus2, ImagePlus, LoaderCircle, Paperclip, Plus, Square } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type SelectHTMLAttributes,
  type SubmitEvent,
  type TextareaHTMLAttributes,
} from "react";

import { useTranslation } from "../../i18n/i18n.js";
import type { AttachmentData } from "./attachments.js";

export type PromptInputAttachment = AttachmentData & Readonly<{ file: File }>;

export type PromptInputMessage = Readonly<{
  files: readonly PromptInputAttachment[];
  text: string;
}>;

type PromptInputError = Readonly<{
  code: "file_too_large" | "invalid_file_type" | "too_many_images" | "total_size_exceeded";
  message: string;
}>;

type PromptInputAttachmentKind = "file" | "image";

type PromptInputAttachmentsContextValue = Readonly<{
  clear: () => void;
  disabled: boolean;
  files: readonly PromptInputAttachment[];
  openFileDialog: (kind: PromptInputAttachmentKind) => void;
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
  attachments?: readonly PromptInputAttachment[];
  disabled?: boolean;
  fileAccept?: string;
  globalDrop?: boolean;
  imageAccept?: string;
  maxFileTotalSize?: number;
  maxFileSize?: number;
  maxImages?: number;
  maxImageTotalSize?: number;
  multiple?: boolean;
  largePasteCharacterThreshold?: number;
  onAttachmentsChange?: (files: readonly PromptInputAttachment[]) => void;
  onError?: (error: PromptInputError) => void;
  onSubmit?: (message: PromptInputMessage, event: SubmitEvent<HTMLFormElement>) => void;
  pastedTextFileName?: string;
  resetKey?: string;
};

export function createPastedTextFile(
  text: string,
  characterThreshold: number,
  fileName: string,
): File | undefined {
  let characterCount = 0;
  // 按 Unicode 字符计数，并在越过阈值时立即返回，避免复制整段大文本。
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    if (codePoint === undefined) {
      break;
    }
    offset += codePoint > 0xffff ? 2 : 1;
    characterCount += 1;
    if (characterCount > characterThreshold) {
      return new File([text], fileName, { type: "text/plain" });
    }
  }
  return undefined;
}

function acceptsFile(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === "") {
    return true;
  }
  return accept.split(",").some((value) => {
    const rule = value.trim();
    if (rule.startsWith(".")) {
      return file.name.toLowerCase().endsWith(rule.toLowerCase());
    }
    return rule.endsWith("/*") ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule;
  });
}

function revokePreview(attachment: PromptInputAttachment) {
  if (attachment.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function PromptInput({
  attachments,
  children,
  className = "",
  disabled = false,
  fileAccept,
  globalDrop = false,
  imageAccept,
  largePasteCharacterThreshold = Number.POSITIVE_INFINITY,
  maxFileTotalSize = Number.POSITIVE_INFINITY,
  maxFileSize = Number.POSITIVE_INFINITY,
  maxImages = Number.POSITIVE_INFINITY,
  maxImageTotalSize = Number.POSITIVE_INFINITY,
  multiple = false,
  onAttachmentsChange,
  onError,
  onPaste,
  onPasteCapture,
  onSubmit,
  pastedTextFileName = "Pasted text.txt",
  resetKey,
  ...props
}: PromptInputProps) {
  const { t } = useTranslation("conversation");
  const [internalFiles, setInternalFiles] = useState<PromptInputAttachment[]>([]);
  const files = attachments ?? internalFiles;
  const filesRef = useRef(files);
  const controlledRef = useRef(attachments !== undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previousResetKeyRef = useRef(resetKey);
  filesRef.current = files;
  controlledRef.current = attachments !== undefined;

  const updateFiles = useCallback(
    (update: (current: readonly PromptInputAttachment[]) => readonly PromptInputAttachment[]) => {
      if (attachments !== undefined) {
        onAttachmentsChange?.(update(attachments));
        return;
      }
      setInternalFiles((current) => [...update(current)]);
    },
    [attachments, onAttachmentsChange],
  );

  const addFiles = useCallback(
    (incoming: readonly File[], allowGeneratedText = false) => {
      updateFiles((current) => {
        if (disabled) {
          return current;
        }
        const accepted: PromptInputAttachment[] = [];
        let imageCount = current.filter((file) => file.kind === "image").length;
        let imageBytes = current.reduce(
          (total, file) => total + (file.kind === "image" ? file.size : 0),
          0,
        );
        let fileBytes = current.reduce(
          (total, file) => total + (file.kind === "image" ? 0 : file.size),
          0,
        );

        // 逐个校验后再占用容量，避免一个非法文件挤掉后续合法文件。
        for (const file of incoming) {
          const kind = allowGeneratedText
            ? "text"
            : acceptsFile(file, imageAccept)
              ? "image"
              : "file";
          const acceptedByType =
            kind === "text" ||
            (kind === "image" ? acceptsFile(file, imageAccept) : acceptsFile(file, fileAccept));
          if (!acceptedByType) {
            onError?.({
              code: "invalid_file_type",
              message: t("aiElements.invalidFileType", { name: file.name }),
            });
            continue;
          }
          if (kind !== "image" && file.size > maxFileSize) {
            onError?.({
              code: "file_too_large",
              message: t("aiElements.fileTooLarge", { name: file.name }),
            });
            continue;
          }
          if (kind === "image" && imageCount >= maxImages) {
            onError?.({
              code: "too_many_images",
              message: t("aiElements.tooManyImages", { count: maxImages }),
            });
            continue;
          }
          if (kind === "image" && imageBytes + file.size > maxImageTotalSize) {
            onError?.({
              code: "total_size_exceeded",
              message: t("aiElements.totalImageSizeExceeded"),
            });
            continue;
          }
          if (kind !== "image" && fileBytes + file.size > maxFileTotalSize) {
            onError?.({
              code: "total_size_exceeded",
              message: t("aiElements.totalAttachmentSizeExceeded"),
            });
            continue;
          }
          accepted.push({
            file,
            id: globalThis.crypto.randomUUID(),
            kind,
            mediaType: file.type,
            name: file.name,
            previewUrl: URL.createObjectURL(file),
            size: file.size,
          });
          if (kind === "image") {
            imageCount += 1;
            imageBytes += file.size;
          } else {
            fileBytes += file.size;
          }
          if (!multiple) {
            break;
          }
        }
        return [...current, ...accepted];
      });
    },
    [
      disabled,
      fileAccept,
      imageAccept,
      maxFileSize,
      maxFileTotalSize,
      maxImages,
      maxImageTotalSize,
      multiple,
      onError,
      t,
      updateFiles,
    ],
  );

  const clear = useCallback(() => {
    updateFiles((current) => {
      current.forEach(revokePreview);
      return [];
    });
    if (fileInputRef.current !== null) fileInputRef.current.value = "";
    if (imageInputRef.current !== null) imageInputRef.current.value = "";
  }, [updateFiles]);

  useLayoutEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return;
    }
    previousResetKeyRef.current = resetKey;
    // 外层业务作用域变化时清空附件，但保留表单和编辑器 DOM，避免中断原生输入法上下文。
    if (attachments === undefined) {
      clear();
    }
  }, [attachments, clear, resetKey]);

  const remove = useCallback(
    (id: string) => {
      updateFiles((current) => {
        const removed = current.find((file) => file.id === id);
        if (removed !== undefined) {
          revokePreview(removed);
        }
        return current.filter((file) => file.id !== id);
      });
    },
    [updateFiles],
  );

  useEffect(
    () => () => {
      if (!controlledRef.current) {
        filesRef.current.forEach(revokePreview);
      }
    },
    [],
  );

  useEffect(() => {
    if (attachments === undefined) {
      onAttachmentsChange?.(internalFiles);
    }
  }, [attachments, internalFiles, onAttachmentsChange]);

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
      openFileDialog: (kind) => {
        if (!disabled) {
          (kind === "image" ? imageInputRef : fileInputRef).current?.click();
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
        className={`overflow-visible rounded-surface border border-transparent bg-raised shadow-floating transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-focus ${className}`}
        data-prompt-input=""
        onPasteCapture={(event) => {
          onPasteCapture?.(event);
          if (disabled || event.defaultPrevented || event.clipboardData.files.length > 0) {
            return;
          }
          const pastedTextFile = createPastedTextFile(
            event.clipboardData.getData("text/plain"),
            largePasteCharacterThreshold,
            pastedTextFileName,
          );
          if (pastedTextFile !== undefined) {
            // capture 阶段先阻止编辑器写入全文，再交给统一附件约束处理。
            event.preventDefault();
            addFiles([pastedTextFile], true);
          }
        }}
        onPaste={(event) => {
          onPaste?.(event);
          if (disabled || event.defaultPrevented) {
            return;
          }
          const pastedFiles = [...event.clipboardData.files];
          if (pastedFiles.length > 0) {
            // 图片由附件预览承载，取消 contenteditable 默认插入，避免正文重复显示。
            event.preventDefault();
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
          accept={imageAccept}
          className="sr-only"
          disabled={disabled}
          multiple={multiple}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            addFiles([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
          ref={imageInputRef}
          tabIndex={-1}
          type="file"
        />
        <input
          accept={fileAccept}
          className="sr-only"
          disabled={disabled}
          multiple={multiple}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            addFiles([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        {children}
      </form>
    </PromptInputAttachmentsContext.Provider>
  );
}

type PromptInputSectionProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputCommand({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`overflow-hidden rounded-surface border border-separator-strong bg-raised shadow-floating ${className}`}
      data-prompt-input-command=""
      role="listbox"
      {...props}
    />
  );
}

export function PromptInputCommandList({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`max-h-96 overflow-y-auto p-1 ${className}`}
      data-prompt-input-command-list=""
      {...props}
    />
  );
}

type PromptInputCommandGroupProps = PromptInputSectionProps & { label: string };

export function PromptInputCommandGroup({
  children,
  className = "",
  label,
  ...props
}: PromptInputCommandGroupProps) {
  return (
    <div aria-label={label} className={className} role="group" {...props}>
      <div className="px-2 py-1.5 text-caption font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

type PromptInputCommandItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  selected?: boolean;
};

export function PromptInputCommandItem({
  active = false,
  className = "",
  onMouseDown,
  selected = false,
  type = "button",
  ...props
}: PromptInputCommandItemProps) {
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) {
      // 键盘切换高亮项时，让滚动容器始终露出当前选项。
      itemRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <button
      aria-selected={selected}
      className={`flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-body-small text-foreground transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${active ? "bg-control-active" : ""} ${className}`}
      data-active={active || undefined}
      onMouseDown={(event) => {
        // 保留输入框焦点，避免鼠标选择命令时丢失光标上下文。
        event.preventDefault();
        onMouseDown?.(event);
      }}
      ref={itemRef}
      role="option"
      type={type}
      {...props}
    />
  );
}

export function PromptInputCommandEmpty({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`px-3 py-5 text-center text-body-small text-muted-foreground ${className}`}
      role="status"
      {...props}
    />
  );
}

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

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea(
    { className = "", name = "message", onKeyDown, rows = 2, ...props },
    forwardedRef,
  ) {
    return (
      <textarea
        className={`max-h-40 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed ${className}`}
        name={name}
        onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
        ref={forwardedRef}
        rows={rows}
        {...props}
      />
    );
  },
);

type PromptInputActionAddAttachmentsProps = PromptInputButtonProps & { label?: string };

export function PromptInputActionAddAttachments({
  children,
  label,
  onClick,
  ...props
}: PromptInputActionAddAttachmentsProps) {
  const attachments = usePromptInputAttachments();
  const { t } = useTranslation("conversation");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const disabled = props.disabled === true || attachments.disabled;
  const accessibleLabel = label ?? t("aiElements.addImageOrFile");

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <PromptInputButton
        {...props}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={accessibleLabel}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setOpen((current) => !current);
        }}
        title={accessibleLabel}
      >
        {children ?? <Paperclip className="size-3.5" aria-hidden="true" />}
      </PromptInputButton>
      <div
        className="absolute bottom-9 left-0 z-50 min-w-36 rounded-control border border-separator-strong bg-raised p-1 shadow-floating"
        hidden={!open}
        role="menu"
      >
        <button
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-label text-foreground hover:bg-control-hover"
          onClick={() => {
            setOpen(false);
            attachments.openFileDialog("image");
          }}
          role="menuitem"
          type="button"
        >
          <ImagePlus aria-hidden="true" className="size-4 text-muted-foreground" />
          {t("aiElements.addImage")}
        </button>
        <button
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-label text-foreground hover:bg-control-hover"
          onClick={() => {
            setOpen(false);
            attachments.openFileDialog("file");
          }}
          role="menuitem"
          type="button"
        >
          <FilePlus2 aria-hidden="true" className="size-4 text-muted-foreground" />
          {t("aiElements.addFile")}
        </button>
      </div>
    </div>
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
