import { Link, createRoute } from "@tanstack/react-router";
import { ArrowLeft, Settings } from "lucide-react";

import { rootRoute } from "./root-route.js";

export const settingsRoute = createRoute({
  component: SettingsPage,
  getParentRoute: () => rootRoute,
  path: "/settings",
});

function SettingsPage() {
  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)] bg-canvas max-[720px]:grid-cols-1 max-[720px]:grid-rows-[56px_minmax(0,1fr)]">
      <aside
        className="border-r border-border bg-surface p-4 max-[720px]:border-r-0 max-[720px]:border-b"
        aria-label="设置导航"
      >
        <Link
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          to="/workspaces"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Workspaces
        </Link>
      </aside>
      <main className="min-h-0 overflow-auto px-6 py-8 sm:px-10" aria-labelledby="settings-title">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <Settings className="size-5 text-accent" aria-hidden="true" />
            <h1 id="settings-title" className="text-xl font-semibold">
              设置
            </h1>
          </div>
          <section className="py-10" aria-label="设置内容">
            <p className="text-sm text-muted-foreground">Runtime 连接后显示可用选项。</p>
          </section>
        </div>
      </main>
    </div>
  );
}
