import { useQuery } from "@tanstack/react-query";
import type { AgentProviderConnectionState, RuntimeReadinessState } from "@code-agent/protocol";
import type { ReactNode } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { ProviderConnectionPanel } from "./provider-connection-panel.js";
import {
  providerConnectionQueryOptions,
  runtimeReadinessQueryOptions,
} from "../provider-connection-queries.js";

type ProviderConnectionGateState = "connected" | "error" | "loading" | "setup";

export function resolveProviderConnectionGateState({
  connectionError,
  connectionPending,
  connectionState,
  readinessError,
  readinessPending,
  runtimeState,
}: Readonly<{
  connectionError: boolean;
  connectionPending: boolean;
  connectionState: AgentProviderConnectionState | undefined;
  readinessError: boolean;
  readinessPending: boolean;
  runtimeState: RuntimeReadinessState | undefined;
}>): ProviderConnectionGateState {
  if (readinessPending || runtimeState === "starting") return "loading";
  if (readinessError || runtimeState !== "ready") return "error";
  if (connectionPending) return "loading";
  if (connectionError) return "error";
  return connectionState === "connected" ? "connected" : "setup";
}

export function ProviderConnectionGate({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation("settings");
  const readiness = useQuery(runtimeReadinessQueryOptions());
  const runtimeReady = readiness.data?.runtime.state === "ready";
  const connection = useQuery({
    ...providerConnectionQueryOptions(),
    enabled: runtimeReady,
  });
  const gateState = resolveProviderConnectionGateState({
    connectionError: connection.error !== null,
    connectionPending: connection.isPending,
    connectionState: connection.data?.state,
    readinessError: readiness.error !== null,
    readinessPending: readiness.isPending,
    runtimeState: readiness.data?.runtime.state,
  });

  if (gateState === "connected") {
    return children;
  }
  if (gateState === "loading") {
    return (
      <main className="grid h-full min-h-0 place-items-center bg-window text-body-small text-muted-foreground">
        {t("provider.loading")}
      </main>
    );
  }
  return (
    <main className="h-full min-h-0 overflow-y-auto bg-window px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-[42rem]">
        <header className="mb-8 border-b border-separator pb-5">
          <h1 className="text-xl font-semibold text-foreground">CodeAgent</h1>
          <p className="mt-1 text-body-small text-muted-foreground">{t("provider.title")}</p>
        </header>
        {gateState === "setup" ? (
          <ProviderConnectionPanel />
        ) : (
          <div className="grid justify-items-start gap-3">
            <Button
              onClick={() => {
                if (readiness.error !== null || readiness.data?.runtime.state === "failed") {
                  window.location.reload();
                  return;
                }
                void connection.refetch();
              }}
              type="button"
              variant="outline"
            >
              {t("provider.retry")}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
