import { CircleAlert, RefreshCw } from "lucide-react";

type RuntimeUnavailableProps = Readonly<{
  onRetry: () => void;
}>;

export function RuntimeUnavailable({ onRetry }: RuntimeUnavailableProps) {
  return (
    <section
      className="grid min-h-0 flex-1 place-items-center bg-content px-6 py-10 text-center"
      aria-labelledby="runtime-unavailable-title"
    >
      <div className="max-w-md">
        <CircleAlert className="mx-auto size-8 text-danger" aria-hidden="true" strokeWidth={1.6} />
        <h1 id="runtime-unavailable-title" className="mt-4 text-xl font-semibold">
          Codex Runtime 不可用
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          请先在官方 Codex CLI 中运行 <code className="font-mono text-foreground">codex login</code>
          ，完成登录后重试。
        </p>
        <button
          className="mx-auto mt-5 inline-flex h-9 items-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          重试
        </button>
      </div>
    </section>
  );
}
