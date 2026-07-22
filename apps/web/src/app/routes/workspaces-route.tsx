import { Link, createRoute } from "@tanstack/react-router";
import { FolderGit2, Plus, Settings } from "lucide-react";

import { IconButton } from "../../shared/ui/icon-button.js";
import { BrandLink, rootRoute } from "./root-route.js";

export const workspacesRoute = createRoute({
  component: WorkspacesPage,
  getParentRoute: () => rootRoute,
  path: "/workspaces",
});

function WorkspacesPage() {
  return (
    <div className="grid h-full grid-rows-[var(--ui-layout-toolbar-height)_minmax(0,1fr)] bg-window">
      <header className="flex items-center justify-between bg-sidebar px-5 shadow-toolbar">
        <BrandLink />
        <Link
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          to="/settings"
        >
          <Settings className="size-4" aria-hidden="true" />
          设置
        </Link>
      </header>
      <main className="min-h-0 overflow-auto px-5 py-8 sm:px-8" aria-labelledby="workspaces-title">
        <div className="mx-auto w-full max-w-5xl">
          <div className="flex items-center justify-between gap-4 pb-4">
            <div>
              <h1 id="workspaces-title" className="text-xl font-semibold">
                Workspaces
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">0 个本地工作区</p>
            </div>
            <IconButton disabled label="添加 Workspace">
              <Plus className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
          <section className="grid min-h-72 place-items-center" aria-label="Workspace 列表">
            <div className="max-w-sm text-center">
              <FolderGit2
                className="mx-auto size-9 text-muted-foreground"
                aria-hidden="true"
                strokeWidth={1.5}
              />
              <h2 className="mt-4 text-base font-semibold">还没有 Workspace</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Runtime 连接后可添加本地工作区。
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
