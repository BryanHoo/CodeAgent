import type { AppInfoResponse } from "@/protocol/index.js";
import { BookOpen, GitFork, LoaderCircle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { cn } from "../../../shared/lib/utils.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { AppReleaseNotesDialog } from "./app-release-notes-dialog.js";
import { SettingsField, SettingsPanel, type SettingsSectionId } from "./global-settings-fields.js";

export function GlobalSettingsAbout({
  activeSection,
  appInfo,
  error,
  isPending,
  onRetry,
}: Readonly<{
  activeSection: SettingsSectionId;
  appInfo?: AppInfoResponse;
  error: Error | null;
  isPending: boolean;
  onRetry: () => unknown;
}>) {
  const { t } = useTranslation("settings");
  const checkLockRef = useRef(createAsyncActionLock());
  const [isChecking, setIsChecking] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
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
        <div className="flex items-center justify-between gap-3 py-4" role="alert">
          <p className="text-body-small text-danger">{t("errors.appInfo")}</p>
          <Button onClick={() => void onRetry()} size="sm" type="button" variant="ghost">
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {t("about.retry")}
          </Button>
        </div>
      ) : (
        <>
          <SettingsField label={t("about.codeagentVersion")}>
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
                href={appInfo.repositoryUrl}
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
              <p
                className={cn(
                  "shrink-0 text-body-small",
                  appInfo.status === "available"
                    ? "text-warning"
                    : appInfo.status === "check-failed"
                      ? "text-danger"
                      : "text-muted-foreground",
                )}
                role={appInfo.status === "check-failed" ? "alert" : "status"}
              >
                {appInfo.status === "available" && appInfo.latestVersion !== null
                  ? t("about.available", { version: appInfo.latestVersion })
                  : appInfo.status === "check-failed"
                    ? t("errors.updateCheck")
                    : t("about.current")}
              </p>
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
            </div>
          </SettingsField>
          <AppReleaseNotesDialog
            changelogUrl={appInfo.changelogUrl}
            notes={appInfo.releaseNotes}
            onClose={() => {
              setReleaseNotesOpen(false);
            }}
            open={releaseNotesOpen}
            version={appInfo.releaseNotesVersion}
          />
        </>
      )}
    </SettingsPanel>
  );
}
