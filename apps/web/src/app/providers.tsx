import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { ProjectProvider } from "../features/projects/project-context.js";
import {
  AccessProvider,
  useAccess,
  type AccessContextValue,
} from "../features/access/access-context.js";
import { PairingGate } from "../features/access/pairing-gate.js";
import { codeAgentClient } from "../features/projects/project-queries.js";
import { createBrowserTaskNotifier } from "../features/notifications/browser-task-notifier.js";
import { ComposerDraftProvider } from "../features/workbench/composer-draft-context.js";
import { I18nextProvider, i18n } from "../i18n/i18n.js";
import { TooltipProvider } from "../shared/ui/tooltip.js";
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

export function AccessControlledContent({
  access,
  children,
}: Readonly<{ access: AccessContextValue; children: ReactNode }>) {
  if (access.status?.authenticated === true) {
    return children;
  }
  return (
    <PairingGate
      error={access.error}
      loading={access.loading}
      onPair={access.pair}
      onRetry={access.retry}
      pairing={access.pairing}
    />
  );
}

function AppProviderContent({ children }: AppProvidersProps) {
  const access = useAccess();
  const { t } = useTranslation("common");
  return (
    <>
      <AccessControlledContent access={access}>
        <ProjectProvider taskNotifier={taskNotifier}>
          <ComposerDraftProvider>{children}</ComposerDraftProvider>
        </ProjectProvider>
      </AccessControlledContent>
      <Toaster
        containerAriaLabel={t("app.notificationRegion")}
        duration={5_000}
        position="top-center"
        richColors
        theme="system"
      />
    </>
  );
}

export function AppProviders({ children }: AppProvidersProps) {
  // SPA 生命周期内复用同一个 QueryClient，避免导航时丢失服务端状态缓存。
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <AccessProvider client={codeAgentClient} queryClient={queryClient}>
            <AppProviderContent>{children}</AppProviderContent>
          </AccessProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </I18nextProvider>
  );
}
