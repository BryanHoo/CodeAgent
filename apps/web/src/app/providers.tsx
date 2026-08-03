import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { ProjectProvider } from "../features/projects/project-context.js";
import { createBrowserTaskNotifier } from "../features/notifications/browser-task-notifier.js";
import { ComposerDraftProvider } from "../features/workbench/composer-draft-context.js";
import { I18nextProvider, i18n } from "../i18n/i18n.js";
import { useTranslation } from "../i18n/i18n.js";
import { installInactiveSnapshotMemoryLimit } from "./snapshot-memory.js";
import { router } from "./router.js";

export const DEFAULT_QUERY_GC_TIME_MS = 2 * 60_000;

export function createAppQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: DEFAULT_QUERY_GC_TIME_MS,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });
  installInactiveSnapshotMemoryLimit(queryClient);
  return queryClient;
}

const queryClient = createAppQueryClient();

export function navigateToTaskFromNotification(projectId: string, taskId: string): void {
  // 交给 Router 完成应用内导航，避免整页刷新丢失瞬时弹窗状态。
  void router.navigate({
    params: { projectId, taskId },
    to: "/p/$projectId/t/$taskId",
  });
}

const taskNotifier = createBrowserTaskNotifier({
  navigateToTask: navigateToTaskFromNotification,
});

type AppProvidersProps = Readonly<{
  children: ReactNode;
}>;

export function AppProviders({ children }: AppProvidersProps) {
  const { t } = useTranslation("common");
  // SPA 生命周期内复用同一个 QueryClient，避免导航时丢失服务端状态缓存。
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ProjectProvider taskNotifier={taskNotifier}>
          <ComposerDraftProvider>{children}</ComposerDraftProvider>
        </ProjectProvider>
        <Toaster
          containerAriaLabel={t("app.notificationRegion")}
          duration={5_000}
          position="top-center"
          richColors
          theme="system"
        />
      </QueryClientProvider>
    </I18nextProvider>
  );
}
