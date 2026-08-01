import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { ProjectProvider } from "../features/projects/project-context.js";
import { ComposerDraftProvider } from "../features/workbench/composer-draft-context.js";
import { installInactiveSnapshotMemoryLimit } from "./snapshot-memory.js";

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

type AppProvidersProps = Readonly<{
  children: ReactNode;
}>;

export function AppProviders({ children }: AppProvidersProps) {
  // SPA 生命周期内复用同一个 QueryClient，避免导航时丢失服务端状态缓存。
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectProvider>
        <ComposerDraftProvider>{children}</ComposerDraftProvider>
      </ProjectProvider>
      <Toaster
        closeButton
        containerAriaLabel="通知"
        duration={5_000}
        position="top-right"
        richColors
        theme="system"
        toastOptions={{ closeButtonAriaLabel: "关闭通知" }}
      />
    </QueryClientProvider>
  );
}
