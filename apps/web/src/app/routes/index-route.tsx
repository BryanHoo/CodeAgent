import { createRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useProjects } from "../../features/projects/project-context.js";
import {
  globalSettingsMutationOptions,
  globalSettingsQueryOptions,
  modelsQueryOptions,
} from "../../features/projects/project-queries.js";
import { GlobalSettingsDialog } from "../../features/settings/components/global-settings-dialog.js";
import { useTranslation } from "../../i18n/i18n.js";
import { RuntimeUnavailable } from "../../shared/ui/runtime-unavailable.js";
import { ProjectSidebar } from "../../features/workbench/components/project-sidebar.js";
import { rootRoute } from "./root-route.js";

export const indexRoute = createRoute({
  component: IndexPage,
  getParentRoute: () => rootRoute,
  path: "/",
});

function IndexPage() {
  const { t } = useTranslation("common");
  const { client, error, isPending, projects, retry } = useProjects();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const globalSettingsQuery = useQuery(globalSettingsQueryOptions(client));
  const modelsQuery = useQuery(modelsQueryOptions(client));
  const globalSettingsMutation = useMutation({
    ...globalSettingsMutationOptions(client),
    onSuccess(response) {
      queryClient.setQueryData(["settings"], response);
    },
  });
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const firstProjectId = projects[0]?.id;

  useEffect(() => {
    if (firstProjectId !== undefined) {
      void navigate({ params: { projectId: firstProjectId }, replace: true, to: "/p/$projectId" });
    }
  }, [firstProjectId, navigate]);

  if (error !== null) {
    return (
      <main className="flex h-full min-h-0">
        <RuntimeUnavailable onRetry={() => void retry()} />
      </main>
    );
  }
  if (isPending || firstProjectId !== undefined) {
    return (
      <main className="grid h-full place-items-center text-sm text-muted-foreground">
        {t("app.loadingProjects")}
      </main>
    );
  }
  return (
    <div
      className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
      data-inspector-open="false"
      data-sidebar-open="true"
    >
      <ProjectSidebar
        connectionState="connected"
        onClose={() => undefined}
        onOpenSettings={() => {
          setGlobalSettingsOpen(true);
        }}
      />
      <main className="grid min-h-0 min-w-0 place-items-center bg-content text-sm text-muted-foreground">
        {t("app.noProjects")}
      </main>
      {globalSettingsOpen ? (
        <GlobalSettingsDialog
          apps={[]}
          error={globalSettingsQuery.error ?? modelsQuery.error}
          isPending={globalSettingsQuery.isPending || modelsQuery.isPending}
          models={modelsQuery.data?.data ?? []}
          onClose={() => {
            setGlobalSettingsOpen(false);
            requestAnimationFrame(() => {
              document.querySelector<HTMLButtonElement>("#global-settings-trigger")?.focus();
            });
          }}
          onRetry={() => Promise.all([globalSettingsQuery.refetch(), modelsQuery.refetch()])}
          onSave={(settings) => globalSettingsMutation.mutateAsync(settings).then(() => undefined)}
          {...(globalSettingsQuery.data === undefined
            ? {}
            : { settings: globalSettingsQuery.data.settings })}
        />
      ) : null}
    </div>
  );
}
