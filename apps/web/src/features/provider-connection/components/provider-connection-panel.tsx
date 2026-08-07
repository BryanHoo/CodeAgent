import type { AgentProviderConnectionStatus } from "@code-agent/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  Server,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { cn } from "../../../shared/lib/utils.js";
import { Button } from "../../../shared/ui/button.js";
import { Input } from "../../../shared/ui/input.js";
import {
  cancelProviderLoginMutationOptions,
  configureCustomProvider,
  logoutProviderMutationOptions,
  providerConnectionQueryOptions,
  startOfficialProviderLoginMutationOptions,
} from "../provider-connection-queries.js";

type ConnectionMode = "custom" | "official";

type ProviderConnectionPanelViewProps = Readonly<{
  apiKey: string;
  baseUrl: string;
  error: string | null;
  isBusy: boolean;
  mode: ConnectionMode;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onCancelLogin: () => void;
  onConfigureCustom: () => void;
  onLogout: () => void;
  onModeChange: (mode: ConnectionMode) => void;
  onRetry: () => void;
  onStartOfficialLogin: () => void;
  status: AgentProviderConnectionStatus | undefined;
}>;

export function ProviderConnectionPanelView({
  apiKey,
  baseUrl,
  error,
  isBusy,
  mode,
  onApiKeyChange,
  onBaseUrlChange,
  onCancelLogin,
  onConfigureCustom,
  onLogout,
  onModeChange,
  onRetry,
  onStartOfficialLogin,
  status,
}: ProviderConnectionPanelViewProps) {
  const { t } = useTranslation("settings");
  const currentModeConnected = status?.mode === mode && status.state === "connected";
  const pendingOfficial = status?.mode === "official" && status.state === "pending";

  return (
    <div className="w-full max-w-[38rem]">
      <div
        aria-label={t("provider.mode")}
        className="grid grid-cols-2 rounded-control bg-control p-1"
        role="group"
      >
        <Button
          aria-pressed={mode === "official"}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-[5px] text-body-small font-medium sm:h-9",
            mode === "official"
              ? "bg-raised text-foreground shadow-control"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            onModeChange("official");
          }}
          type="button"
          variant="ghost"
        >
          <LogIn aria-hidden="true" data-icon="inline-start" />
          {t("provider.official")}
        </Button>
        <Button
          aria-pressed={mode === "custom"}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-[5px] text-body-small font-medium sm:h-9",
            mode === "custom"
              ? "bg-raised text-foreground shadow-control"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            onModeChange("custom");
          }}
          type="button"
          variant="ghost"
        >
          <Server aria-hidden="true" data-icon="inline-start" />
          {t("provider.custom")}
        </Button>
      </div>

      <div className="mt-5">
        {mode === "official" ? (
          <div className="grid gap-4">
            <div className="flex min-h-12 items-center gap-3 border-b border-separator pb-4">
              {currentModeConnected ? (
                <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-primary" />
              ) : pendingOfficial ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-5 shrink-0 animate-spin text-primary"
                />
              ) : (
                <LogIn aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className="text-body-small font-medium text-foreground">
                  {currentModeConnected
                    ? t("provider.connected")
                    : pendingOfficial
                      ? t("provider.waiting")
                      : t("provider.disconnected")}
                </p>
                {status?.account?.type === "chatgpt" && status.account.email !== null ? (
                  <p className="truncate text-meta text-muted-foreground">{status.account.email}</p>
                ) : null}
              </div>
            </div>
            {pendingOfficial ? (
              <Button
                className="h-11 justify-self-start sm:h-9"
                disabled={isBusy}
                onClick={onCancelLogin}
                type="button"
                variant="outline"
              >
                <X aria-hidden="true" className="size-4" />
                {t("provider.cancelLogin")}
              </Button>
            ) : currentModeConnected ? (
              <Button
                className="h-11 justify-self-start sm:h-9"
                disabled={isBusy}
                onClick={onLogout}
                type="button"
                variant="outline"
              >
                <LogOut aria-hidden="true" className="size-4" />
                {t("provider.logout")}
              </Button>
            ) : (
              <Button
                className="h-11 justify-self-start sm:h-9"
                disabled={isBusy}
                onClick={onStartOfficialLogin}
                type="button"
              >
                {isBusy ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <LogIn aria-hidden="true" className="size-4" />
                )}
                {t("provider.login")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-body-small font-medium text-foreground">
              {t("provider.baseUrl")}
              <Input
                autoCapitalize="none"
                autoComplete="url"
                className="h-11 rounded-control border border-separator-strong bg-panel px-3 text-body-small outline-none focus:border-primary focus:shadow-focus sm:h-9"
                disabled={isBusy}
                inputMode="url"
                maxLength={2_048}
                onChange={(event) => {
                  onBaseUrlChange(event.currentTarget.value);
                }}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                type="url"
                value={baseUrl}
              />
            </label>
            <label className="grid gap-1.5 text-body-small font-medium text-foreground">
              {t("provider.apiKey")}
              <div className="relative">
                <KeyRound
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  autoComplete="new-password"
                  className="h-11 w-full rounded-control border border-separator-strong bg-panel pl-9 pr-3 text-body-small outline-none focus:border-primary focus:shadow-focus sm:h-9"
                  disabled={isBusy}
                  maxLength={16_384}
                  onChange={(event) => {
                    onApiKeyChange(event.currentTarget.value);
                  }}
                  spellCheck={false}
                  type="password"
                  value={apiKey}
                />
              </div>
            </label>
            {currentModeConnected ? (
              <div className="flex items-center gap-2 text-body-small text-primary">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                <span>{t("provider.connected")}</span>
              </div>
            ) : null}
            <Button
              className="h-11 justify-self-start sm:h-9"
              disabled={isBusy || baseUrl.trim().length === 0}
              onClick={onConfigureCustom}
              type="button"
            >
              {isBusy ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Server aria-hidden="true" className="size-4" />
              )}
              {currentModeConnected ? t("provider.reconnect") : t("provider.connect")}
            </Button>
          </div>
        )}
      </div>

      {error === null ? null : (
        <div className="mt-4 flex items-center justify-between gap-3 text-body-small" role="alert">
          <p className="min-w-0 text-danger">{error}</p>
          <Button
            aria-label={t("provider.retry")}
            className="shrink-0"
            onClick={onRetry}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function openOfficialAuthUrl(authUrl: string): void {
  const url = new URL(authUrl);
  if (url.protocol !== "https:") {
    throw new Error("Official login URL must use HTTPS");
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ProviderConnectionPanel() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const connectionQuery = useQuery(providerConnectionQueryOptions());
  const officialLogin = useMutation(startOfficialProviderLoginMutationOptions(queryClient));
  const cancelLogin = useMutation(cancelProviderLoginMutationOptions(queryClient));
  const logout = useMutation(logoutProviderMutationOptions(queryClient));
  const [mode, setMode] = useState<ConnectionMode>("official");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [customPending, setCustomPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const status = connectionQuery.data;

  useEffect(() => {
    if (status === undefined) return;
    setMode(status.mode);
    if (status.customBaseUrl !== null) setBaseUrl(status.customBaseUrl);
  }, [status]);

  const isBusy =
    officialLogin.isPending || cancelLogin.isPending || logout.isPending || customPending;
  const requestError =
    localError ??
    (connectionQuery.error ?? officialLogin.error ?? cancelLogin.error ?? logout.error)?.message ??
    null;

  return (
    <ProviderConnectionPanelView
      apiKey={apiKey}
      baseUrl={baseUrl}
      error={requestError}
      isBusy={isBusy}
      mode={mode}
      onApiKeyChange={setApiKey}
      onBaseUrlChange={setBaseUrl}
      onCancelLogin={() => {
        const loginId = status?.pendingLogin?.loginId;
        if (loginId !== undefined) void cancelLogin.mutateAsync(loginId);
      }}
      onConfigureCustom={() => {
        setLocalError(null);
        setCustomPending(true);
        const input = {
          ...(apiKey.length === 0 ? {} : { apiKey }),
          baseUrl: baseUrl.trim(),
        };
        void configureCustomProvider(input, queryClient)
          .then(() => {
            setApiKey("");
          })
          .catch(() => {
            setLocalError(t("provider.errors.connect"));
          })
          .finally(() => {
            setApiKey("");
            setCustomPending(false);
          });
      }}
      onLogout={() => {
        void logout.mutateAsync();
      }}
      onModeChange={(nextMode) => {
        setLocalError(null);
        setMode(nextMode);
      }}
      onRetry={() => {
        void connectionQuery.refetch();
      }}
      onStartOfficialLogin={() => {
        setLocalError(null);
        void officialLogin
          .mutateAsync()
          .then((result) => {
            openOfficialAuthUrl(result.authUrl);
          })
          .catch(() => {
            setLocalError(t("provider.errors.login"));
          });
      }}
      status={status}
    />
  );
}
