import { Link, Outlet, createRootRoute } from "@tanstack/react-router";

import { NotFound } from "./not-found.js";

export const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error, reset }) => (
    <main
      className="grid h-full place-items-center bg-canvas px-6"
      aria-labelledby="route-error-title"
    >
      <section className="w-full max-w-lg border-l-2 border-danger pl-5">
        <p className="mb-2 text-xs font-semibold text-danger uppercase">Route error</p>
        <h1 id="route-error-title" className="text-xl font-semibold text-foreground">
          页面加载失败
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          className="mt-5 border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
          onClick={reset}
          type="button"
        >
          重试
        </button>
      </section>
    </main>
  ),
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <div className="h-dvh min-h-0 bg-canvas text-foreground" data-testid="app-root">
      <Outlet />
    </div>
  );
}

export function BrandLink() {
  return (
    <Link className="inline-flex items-center gap-2 font-semibold text-foreground" to="/workspaces">
      <span className="grid size-7 place-items-center bg-foreground text-xs font-bold text-surface">
        CA
      </span>
      <span>CodeAgentWindow</span>
    </Link>
  );
}
