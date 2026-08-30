import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  Copy,
  Download,
  LoaderCircle,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  downloadAndInspectCodexRuntime,
  inspectCodexRuntime,
} from "../../../platform/tauri/codex-runtime-manager.js";
import type { CodexRuntimeAvailability } from "../../../protocol/index.js";
import { Button } from "../../../shared/components/core/button.js";

const CODEX_RUNTIME_QUERY_KEY = ["codex-runtime-availability"] as const;

type CodexRuntimeGateProps = Readonly<{ children: ReactNode }>;

export function CodexRuntimeGate({ children }: CodexRuntimeGateProps) {
  const queryClient = useQueryClient();
  const availabilityQuery = useQuery({
    queryFn: inspectCodexRuntime,
    queryKey: CODEX_RUNTIME_QUERY_KEY,
    retry: false,
    staleTime: 0,
  });
  const installMutation = useMutation({
    mutationFn: downloadAndInspectCodexRuntime,
    onSuccess(availability) {
      queryClient.setQueryData(CODEX_RUNTIME_QUERY_KEY, availability);
    },
  });

  if (availabilityQuery.data?.status === "compatible") {
    return children;
  }
  if (availabilityQuery.isPending) {
    return <RuntimeChecking />;
  }
  return (
    <RuntimeSetup
      availability={availabilityQuery.data}
      detectionFailed={availabilityQuery.isError}
      installFailed={installMutation.isError}
      isInstalling={installMutation.isPending}
      isRefreshing={availabilityQuery.isFetching}
      onDownload={() => installMutation.mutate()}
      onRefresh={() => {
        installMutation.reset();
        void availabilityQuery.refetch();
      }}
    />
  );
}

function RuntimeChecking() {
  const { t } = useTranslation("common");
  return (
    <main className="grid h-full place-items-center bg-window text-muted-foreground">
      <div className="flex items-center gap-2 text-sm" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {t("runtimeSetup.checking")}
      </div>
    </main>
  );
}

type RuntimeSetupProps = Readonly<{
  availability: CodexRuntimeAvailability | undefined;
  detectionFailed: boolean;
  installFailed: boolean;
  isInstalling: boolean;
  isRefreshing: boolean;
  onDownload: () => void;
  onRefresh: () => void;
}>;

function RuntimeSetup({
  availability,
  detectionFailed,
  installFailed,
  isInstalling,
  isRefreshing,
  onDownload,
  onRefresh,
}: RuntimeSetupProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const command =
    availability?.globalInstallCommand ?? "npm install -g @openai/codex@0.151.0";
  const requiredVersion = availability?.requiredVersion ?? "0.151.0";
  const failed = detectionFailed || availability?.status === "failed";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyCommand = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  };

  return (
    <main className="h-full overflow-y-auto bg-window text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-10 py-9">
        <img
          alt="CodeAgent"
          className="h-7 w-auto self-start"
          height="28"
          src="/brand/codeagent-logo.svg"
          width="116"
        />

        <section className="my-auto py-12" aria-labelledby="codex-runtime-title">
          <div className="flex items-start gap-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-control bg-danger/10 text-danger">
              <CircleAlert className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold text-danger uppercase">
                {t("runtimeSetup.statusLabel")}
              </p>
              <h1 id="codex-runtime-title" className="mt-1 text-2xl font-semibold">
                {failed
                  ? t("runtimeSetup.detectionFailedTitle")
                  : t("runtimeSetup.unsupportedTitle")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {availability?.status === "incompatible" &&
                availability.detectedVersion !== null
                  ? t("runtimeSetup.incompatibleDescription", {
                      detectedVersion: availability.detectedVersion,
                      requiredVersion,
                    })
                  : failed
                    ? t("runtimeSetup.detectionFailedDescription", { requiredVersion })
                    : t("runtimeSetup.missingDescription", { requiredVersion })}
              </p>
            </div>
          </div>

          <div className="mt-8 border-y border-separator">
            <RecoveryOption icon={<Terminal />} title={t("runtimeSetup.globalTitle")}>
              <p className="text-sm leading-6 text-muted-foreground">
                {t("runtimeSetup.globalDescription")}
              </p>
              <div className="mt-3 flex h-10 items-center gap-3 rounded-control border border-separator-strong bg-terminal px-3 text-terminal-foreground">
                <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs">
                  {command}
                </code>
                <button
                  aria-label={copied ? t("runtimeSetup.copied") : t("runtimeSetup.copyCommand")}
                  className="grid size-7 shrink-0 place-items-center rounded-control text-terminal-muted outline-none hover:bg-terminal-control-hover hover:text-terminal-foreground focus-visible:shadow-focus"
                  onClick={() => void copyCommand()}
                  title={copied ? t("runtimeSetup.copied") : t("runtimeSetup.copyCommand")}
                  type="button"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </div>
            </RecoveryOption>

            <RecoveryOption icon={<Download />} title={t("runtimeSetup.privateTitle")}>
              <p className="text-sm leading-6 text-muted-foreground">
                {t("runtimeSetup.privateDescription")}
              </p>
              <Button
                className="mt-3"
                disabled={isInstalling || isRefreshing}
                onClick={onDownload}
                type="button"
              >
                {isInstalling ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                {isInstalling ? t("runtimeSetup.downloading") : t("runtimeSetup.download")}
              </Button>
            </RecoveryOption>
          </div>

          {installFailed ? (
            <p className="mt-4 text-sm text-danger" role="alert">
              {t("runtimeSetup.installFailed")}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-6">
            <p className="text-xs leading-5 text-subtle-foreground">
              {t("runtimeSetup.refreshDescription")}
            </p>
            <Button
              disabled={isInstalling || isRefreshing}
              onClick={onRefresh}
              type="button"
              variant="outline"
            >
              <RefreshCw className={isRefreshing ? "animate-spin" : undefined} aria-hidden="true" />
              {isRefreshing ? t("runtimeSetup.refreshing") : t("runtimeSetup.refresh")}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

type RecoveryOptionProps = Readonly<{
  children: ReactNode;
  icon: ReactNode;
  title: string;
}>;

function RecoveryOption({ children, icon, title }: RecoveryOptionProps) {
  return (
    <section className="grid grid-cols-[36px_1fr] gap-4 border-b border-separator py-5 last:border-b-0">
      <span className="mt-0.5 grid size-9 place-items-center rounded-control bg-control text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="mt-1">{children}</div>
      </div>
    </section>
  );
}
