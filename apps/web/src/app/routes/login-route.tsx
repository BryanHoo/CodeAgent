import { createRoute } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";

import { BrandLink, rootRoute } from "./root-route.js";

export const loginRoute = createRoute({
  component: LoginPage,
  getParentRoute: () => rootRoute,
  path: "/login",
});

function LoginPage() {
  return (
    <div className="grid h-full grid-rows-[var(--ui-layout-toolbar-height)_1fr] bg-window">
      <header className="flex items-center bg-sidebar px-5 shadow-toolbar backdrop-blur-panel">
        <BrandLink />
      </header>
      <main className="grid min-h-0 place-items-center px-6" aria-labelledby="login-title">
        <section className="w-full max-w-sm rounded-surface bg-raised px-7 py-8 text-center shadow-panel">
          <LockKeyhole
            className="mx-auto size-8 text-accent"
            aria-hidden="true"
            strokeWidth={1.6}
          />
          <h1 id="login-title" className="mt-5 text-2xl font-semibold">
            登录
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Runtime 当前不可用。</p>
          <button
            className="mt-6 w-full rounded-control bg-control px-4 py-2.5 text-body font-medium text-muted-foreground shadow-sm disabled:cursor-not-allowed"
            disabled
            type="button"
          >
            等待 Runtime
          </button>
        </section>
      </main>
    </div>
  );
}
