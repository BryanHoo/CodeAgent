import type { AppInfoResponse } from "@code-agent/protocol";
import { BookOpen, Download, GitFork, LoaderCircle, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { showErrorToast, useErrorToast } from "../../../shared/errors/error-toast.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { AppReleaseNotesDialog } from "./app-release-notes-dialog.js";
import { SettingsField, SettingsPanel, type SettingsSectionId } from "./global-settings-fields.js";

export function GlobalSettingsAbout({
  activeSection,
  appInfo,
  error,
  isPending,
  isUpdatePending,
  onRetry,
  onUpdate,
  updateError,
}: Readonly<{
  activeSection: SettingsSectionId;
  appInfo?: AppInfoResponse;
  error: Error | null;
  isPending: boolean;
  isUpdatePending?: boolean;
  onRetry: () => unknown;
  onUpdate: (version: string) => Promise<void>;
  updateError?: Error | null;
}>) {
  const { t } = useTranslation("settings");
  const updateLockRef = useRef(createAsyncActionLock());
  const checkLockRef = useRef(createAsyncActionLock());
  const [isChecking, setIsChecking] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const updating = isUpdating || isUpdatePending === true;
  const appInfoError = useMemo(
    () =>
      appInfo?.error === null || appInfo?.error === undefined ? null : new Error(appInfo.error),
    [appInfo?.error],
  );
  useErrorToast(error);
  useErrorToast(appInfoError);
  useErrorToast(updateError);
  const checkForUpdates = () =>
    checkLockRef.current.run(async () => {
      setIsChecking(true);
      try {
        await onRetry();
      } finally {
        setIsChecking(false);
      }
    });

  return (
    <SettingsPanel activeSection={activeSection} id="about" title={t("sections.about")}>
      {isPending ? (
        <p className="py-5 text-body-small text-muted-foreground" role="status">
          {t("about.loading")}
        </p>
      ) : error !== null || appInfo === undefined ? (
        <div className="flex items-center justify-end gap-3 py-4">
          <Button onClick={() => void onRetry()} size="sm" type="button" variant="ghost">
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {t("about.retry")}
          </Button>
        </div>
      ) : (
        <>
          <SettingsField label={t("about.codeAgentVersion")}>
            <span className="font-mono text-body-small text-foreground">{appInfo.appVersion}</span>
          </SettingsField>
          <SettingsField label={t("about.codexVersion")}>
            <span className="font-mono text-body-small text-foreground">
              {appInfo.codexVersion}
            </span>
          </SettingsField>
          <SettingsField label={t("about.github")}>
            <Button asChild className="justify-self-start" size="sm" variant="link">
              <a
                href="https://github.com/BryanHoo/CodeAgent"
                rel="noopener noreferrer"
                target="_blank"
              >
                <GitFork aria-hidden="true" data-icon="inline-start" />
                BryanHoo/CodeAgent
              </a>
            </Button>
          </SettingsField>
          <SettingsField alignStart label={t("about.update")}>
            <div className="flex min-w-0 flex-wrap items-center gap-2 py-2">
              {appInfo.status === "check-failed" ? null : (
                <p
                  className={`shrink-0 text-body-small ${
                    appInfo.status === "available" ? "text-warning" : "text-muted-foreground"
                  }`}
                  role="status"
                >
                  {appInfo.status === "available" && appInfo.latestVersion !== null
                    ? t("about.available", { version: appInfo.latestVersion })
                    : appInfo.status === "restart-required"
                      ? t("about.restartRequired")
                      : t("about.current")}
                </p>
              )}
              <Button
                disabled={isChecking}
                onClick={() => void checkForUpdates()}
                size="sm"
                type="button"
                variant="ghost"
              >
                {isChecking ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <RefreshCw aria-hidden="true" data-icon="inline-start" />
                )}
                {isChecking ? t("about.checking") : t("about.check")}
              </Button>
              {appInfo.status === "available" && appInfo.latestVersion !== null ? (
                <>
                  <Button
                    onClick={() => {
                      setReleaseNotesOpen(true);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <BookOpen aria-hidden="true" data-icon="inline-start" />
                    {t("about.releaseNotes")}
                  </Button>
                  <Button
                    disabled={updating}
                    onClick={() => {
                      const version = appInfo.latestVersion;
                      if (version === null) return;
                      void updateLockRef.current.run(async () => {
                        setIsUpdating(true);
                        try {
                          await onUpdate(version);
                        } catch (error) {
                          showErrorToast(error);
                        } finally {
                          setIsUpdating(false);
                        }
                      });
                    }}
                    size="sm"
                    type="button"
                  >
                    {updating ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <Download aria-hidden="true" data-icon="inline-start" />
                    )}
                    {updating
                      ? t("about.updating")
                      : t("about.updateTo", { version: appInfo.latestVersion })}
                  </Button>
                </>
              ) : null}
            </div>
          </SettingsField>
          {appInfo.latestVersion === null ? null : (
            <AppReleaseNotesDialog
              notes={appInfo.releaseNotes}
              onClose={() => {
                setReleaseNotesOpen(false);
              }}
              open={releaseNotesOpen}
              version={appInfo.latestVersion}
            />
          )}
        </>
      )}
    </SettingsPanel>
  );
}
