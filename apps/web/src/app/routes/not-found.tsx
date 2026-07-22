import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function NotFound() {
  return (
    <main
      className="grid h-full place-items-center bg-canvas px-6"
      aria-labelledby="not-found-title"
    >
      <section className="w-full max-w-md border-l-2 border-warning pl-5">
        <p className="mb-2 font-mono text-xs text-warning">404</p>
        <h1 id="not-found-title" className="text-xl font-semibold">
          页面不存在
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          当前地址不属于已注册的应用路由。
        </p>
        <Link
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-accent-strong"
          to="/workspaces"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回 Workspaces
        </Link>
      </section>
    </main>
  );
}
