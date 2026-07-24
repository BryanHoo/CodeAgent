import { FileImage, X } from "lucide-react";
import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export type AttachmentData = Readonly<{
  id: string;
  mediaType: string;
  name: string;
  previewUrl: string;
  size: number;
}>;

type AttachmentContextValue = Readonly<{
  data: AttachmentData;
  onRemove?: () => void;
}>;

const AttachmentContext = createContext<AttachmentContextValue | undefined>(undefined);

function useAttachment() {
  const context = useContext(AttachmentContext);
  if (context === undefined) {
    throw new Error("Attachment components must be used inside Attachment");
  }
  return context;
}

export function Attachments({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex max-w-full flex-wrap gap-1.5 px-1 pb-1 ${className}`}
      data-attachments="true"
      {...props}
    />
  );
}

type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData;
  onRemove?: () => void;
};

export function Attachment({ className = "", data, onRemove, ...props }: AttachmentProps) {
  return (
    <AttachmentContext.Provider value={{ data, ...(onRemove === undefined ? {} : { onRemove }) }}>
      <div
        className={`flex h-10 max-w-56 items-center gap-2 rounded-control bg-control px-1.5 text-label text-foreground ${className}`}
        {...props}
      />
    </AttachmentContext.Provider>
  );
}

export function AttachmentPreview({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  const { data } = useAttachment();
  return (
    <div
      className={`grid size-7 shrink-0 place-items-center overflow-hidden rounded-control bg-raised ${className}`}
      {...props}
    >
      {data.mediaType.startsWith("image/") ? (
        <img alt="" className="size-full object-cover" src={data.previewUrl} />
      ) : (
        <FileImage className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

export function AttachmentInfo({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  const { data } = useAttachment();
  const size = data.size < 1024 ? `${String(data.size)} B` : `${(data.size / 1024).toFixed(1)} KB`;
  return (
    <div className={`min-w-0 flex-1 ${className}`} {...props}>
      <div className="truncate font-medium">{data.name}</div>
      <div className="text-caption text-muted-foreground">{size}</div>
    </div>
  );
}

type AttachmentRemoveProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
};

export function AttachmentRemove({
  children,
  className = "",
  onClick,
  type = "button",
  ...props
}: AttachmentRemoveProps) {
  const { data, onRemove } = useAttachment();
  return (
    <button
      aria-label={`移除 ${data.name}`}
      className={`grid size-6 shrink-0 place-items-center rounded-control text-muted-foreground hover:bg-control-hover hover:text-foreground ${className}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onRemove?.();
        }
      }}
      type={type}
      {...props}
    >
      {children ?? <X className="size-3.5" aria-hidden="true" />}
    </button>
  );
}
