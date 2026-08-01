import { CheckCircle, X } from "lucide-react";

type SuccessToastProps = Readonly<{
  message: string;
  onDismiss: () => void;
}>;

export function SuccessToast({ message, onDismiss }: SuccessToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex justify-center sm:justify-end">
      <div
        className="pointer-events-auto flex min-h-11 w-full max-w-sm items-center gap-2 rounded-surface bg-raised px-3 py-2 text-body-small text-foreground shadow-panel"
        data-toast="success"
        role="status"
      >
        <CheckCircle aria-hidden="true" className="size-4 shrink-0 text-diff-added" />
        <span className="min-w-0 flex-1 font-medium">{message}</span>
        <button
          aria-label="关闭成功提示"
          className="grid size-7 shrink-0 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
