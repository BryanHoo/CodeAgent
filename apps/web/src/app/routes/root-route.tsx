import { Link, Outlet, createRootRoute } from "@tanstack/react-router";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { useErrorToast } from "../../shared/errors/error-toast.js";
import { NotFound } from "./not-found.js";

export const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

function RouteError({ error, reset }: Readonly<{ error: Error; reset: () => void }>) {
  const { t } = useTranslation("common");
  useErrorToast(error);
  return (
    <main className="grid h-full place-items-center bg-window px-6">
      <section className="w-full max-w-lg rounded-surface bg-raised p-6 shadow-panel">
        <Button
          variant="ghost"
          className="rounded-control bg-control px-3 py-2 text-body font-medium text-foreground shadow-sm transition-colors hover:bg-control-hover"
          onClick={reset}
          type="button"
        >
          {t("actions.retry")}
        </Button>
      </section>
    </main>
  );
}

function RootLayout() {
  return (
    <div className="h-full min-h-0 bg-window text-foreground" data-testid="app-root">
      <Outlet />
    </div>
  );
}

export function BrandLink() {
  return (
    <Link className="inline-flex items-center gap-2 font-semibold text-foreground" to="/">
      <span className="grid size-7 place-items-center rounded-control bg-foreground text-label font-bold text-raised shadow-sm">
        CA
      </span>
      <span>CodeAgent</span>
    </Link>
  );
}
