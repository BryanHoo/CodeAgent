import type {
  AgentGlobalSettings,
  AgentModel,
  AppInfoResponse,
  AppUpdateInstallProgress,
  ExportDiagnosticsResponse,
  ProjectOpenApp,
} from "@/protocol/index.js";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../../shared/components/core/button.js";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { getNotificationPreference } from "../notification-preference.js";
import type { ThemePreference } from "../theme-preference.js";
import {
  FastModeSettingsField,
  ModelSelect,
  ReasoningSelect,
  SettingsField,
  SettingsPanel,
  type SettingsSectionId,
} from "./global-settings-fields.js";
import {
  applyApprovalMode,
  createFallbackSettings,
  readInitialTheme,
  resolveGlobalSettingsModel,
} from "./global-settings-model.js";
import {
  createGlobalSettingsSaveQueue,
  SETTINGS_INPUT_DEBOUNCE_MS,
} from "./global-settings-save.js";
import { GlobalSettingsAbout } from "./global-settings-about.js";
import { ProviderConnectionPanel } from "../../provider-connection/components/provider-connection-panel.js";
import { GlobalSettingsPets } from "../../pets/components/global-settings-pets.js";
import { useWorkbenchBackgroundDraft } from "./use-workbench-background-draft.js";
import { GlobalSettingsBackground } from "./global-settings-background.js";
import { applyBrowserSettingsChanges } from "./browser-settings-apply.js";
import { GeneralSettingsPanel } from "./general-settings-panel.js";
import { SettingsPageFrame } from "./settings-page-frame.js";
export { resolveGlobalSettingsModel } from "./global-settings-model.js";

type GlobalSettingsPageProps = Readonly<{
  appInfo?: AppInfoResponse;
  appInfoError?: Error | null;
  apps: readonly ProjectOpenApp[];
  error: Error | null;
  fastModeAvailable?: boolean;
  initialSection?: SettingsSectionId;
  isAppInfoPending?: boolean;
  isPending: boolean;
  models: readonly AgentModel[];
  onClose: () => void;
  onRetry: () => unknown;
  onRetryAppInfo?: () => unknown;
  onExportDiagnostics?: () => Promise<ExportDiagnosticsResponse>;
  onSave: (settings: AgentGlobalSettings) => Promise<void>;
  onUpdate?: (
    version: string,
    onProgress: (progress: AppUpdateInstallProgress) => void,
  ) => Promise<void>;
  settings?: AgentGlobalSettings;
}>;

export function GlobalSettingsPage({
  appInfo,
  appInfoError = null,
  apps,
  error,
  fastModeAvailable = false,
  initialSection = "appearance",
  isAppInfoPending = false,
  isPending,
  models,
  onClose,
  onRetry,
  onRetryAppInfo = () => undefined,
  onExportDiagnostics = () => Promise.resolve({ status: "cancelled" }),
  onSave,
  onUpdate = () => Promise.resolve(),
  settings,
}: GlobalSettingsPageProps) {
  const { t } = useTranslation("settings");
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [draft, setDraft] = useState<AgentGlobalSettings>(
    () => settings ?? createFallbackSettings(models),
  );
  const [theme, setTheme] = useState<ThemePreference>(readInitialTheme);
  const {
    acknowledgeBackgroundMutation,
    addCustomBackgroundFiles,
    background,
    backgroundMutation,
    customBackgroundMissing,
    customImages,
    removeCustomBackgroundImage,
    selectCustomBackgroundImage,
    setBackground,
  } = useWorkbenchBackgroundDraft();
  const [language, setLanguage] = useState(getCurrentLanguage);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const draftRef = useRef(draft);
  const hasLocalChangesRef = useRef(false);
  const saveQueueRef = useRef<ReturnType<typeof createGlobalSettingsSaveQueue> | null>(null);
  if (saveQueueRef.current === null) {
    saveQueueRef.current = createGlobalSettingsSaveQueue((next) => onSaveRef.current(next));
    if (settings !== undefined) saveQueueRef.current.reset(settings);
  }
  const saveQueue = saveQueueRef.current;
  const appliedBackgroundRef = useRef(background);
  const [isApplyingBackground, setIsApplyingBackground] = useState(false);
  const selectedModel = models.find((model) => model.id === draft.model);
  useEffect(() => {
    if (settings !== undefined && !hasLocalChangesRef.current) {
      draftRef.current = settings;
      setDraft(settings);
      saveQueue.reset(settings);
    }
  }, [saveQueue, settings]);

  useEffect(() => {
    const assetsChanged =
      backgroundMutation.deletedImageIds.length > 0 ||
      backgroundMutation.imagesToSave.length > 0;
    const preferenceChanged =
      JSON.stringify(appliedBackgroundRef.current) !== JSON.stringify(background);
    if ((!assetsChanged && !preferenceChanged) || customBackgroundMissing) return;

    setIsApplyingBackground(true);
    const frame = requestAnimationFrame(() => {
      void applyBrowserSettingsChanges({
        background,
        customBackgroundMutation: backgroundMutation,
      })
        .then(() => {
          appliedBackgroundRef.current = background;
          acknowledgeBackgroundMutation(backgroundMutation);
        })
        .catch(() => {
          // 本地偏好写入失败时保留当前界面状态，后续更改会再次尝试。
        })
        .finally(() => {
          setIsApplyingBackground(false);
        });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    acknowledgeBackgroundMutation,
    background,
    backgroundMutation,
    customBackgroundMissing,
  ]);

  const updateDraft = (
    update: (current: AgentGlobalSettings) => AgentGlobalSettings,
    debounce = false,
  ) => {
    const next = update(draftRef.current);
    draftRef.current = next;
    hasLocalChangesRef.current = true;
    setDraft(next);
    if (debounce) {
      saveQueue.schedule(next, SETTINGS_INPUT_DEBOUNCE_MS);
    } else {
      saveQueue.save(next);
    }
  };

  const close = () => {
    void saveQueue.flush(draftRef.current);
    onClose();
  };

  return (
    <SettingsPageFrame
      activeSection={activeSection}
      onBack={close}
      onSectionChange={setActiveSection}
    >
      <GlobalSettingsAbout
        activeSection={activeSection}
        {...(appInfo === undefined ? {} : { appInfo })}
        error={appInfoError}
        isPending={isAppInfoPending}
        onRetry={onRetryAppInfo}
        onExportDiagnostics={onExportDiagnostics}
        onUpdate={onUpdate}
      />

      {activeSection === "provider" ? (
        <section id="settings-panel-provider">
          <h1 className="mb-8 text-title font-semibold">{t("sections.provider")}</h1>
          <ProviderConnectionPanel />
        </section>
      ) : activeSection === "about" ? null : error !== null ? (
        <div
          className="flex min-h-40 flex-col items-center justify-center gap-3"
          role="alert"
        >
          <p className="text-body-small text-danger">{t("errors.load")}</p>
          <Button
            variant="ghost"
            className="h-8 rounded-control bg-control px-3 text-body-small font-medium hover:bg-control-hover"
            onClick={() => void onRetry()}
            type="button"
          >
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : isPending || settings === undefined ? (
        <div
          className="grid min-h-40 place-items-center text-body-small text-muted-foreground"
          role="status"
        >
          {t("loading")}
        </div>
      ) : (
        <>
          <GeneralSettingsPanel
            activeSection={activeSection}
            apps={apps}
            settings={draft}
            onApprovalModeChange={(mode) => updateDraft((current) => applyApprovalMode(current, mode))}
            onSandboxChange={(sandboxMode) => updateDraft((current) => ({ ...current, sandboxMode }))}
            onFollowUpChange={(followUpBehavior) => updateDraft((current) => ({ ...current, followUpBehavior }))}
            language={language}
            notificationsEnabled={notificationsEnabled}
            onDefaultOpenAppChange={(defaultOpenAppId) => {
              updateDraft((current) => ({ ...current, defaultOpenAppId }));
            }}
            onLanguageChange={(nextLanguage) => {
              setLanguage(nextLanguage);
              void applyBrowserSettingsChanges({ language: nextLanguage }).catch(
                () => undefined,
              );
            }}
            onNotificationsChange={(enabled) => {
              setNotificationsEnabled(enabled);
              void applyBrowserSettingsChanges({ notificationsEnabled: enabled }).catch(
                () => undefined,
              );
            }}
            onThemeChange={(nextTheme) => {
              setTheme(nextTheme);
              void applyBrowserSettingsChanges({ theme: nextTheme }).catch(() => undefined);
            }}
            theme={theme}
          />

          <GlobalSettingsBackground
            activeSection={activeSection}
            customImages={customImages}
            disabled={isApplyingBackground}
            onCustomFilesAdd={addCustomBackgroundFiles}
            onCustomImageRemove={removeCustomBackgroundImage}
            onCustomImageSelect={selectCustomBackgroundImage}
            onPreferenceChange={setBackground}
            preference={background}
          />

          {activeSection === "pets" ? (
            <GlobalSettingsPets
              onChange={(pet) => {
                updateDraft((current) => ({ ...current, pet }));
              }}
              settings={draft.pet}
            />
          ) : null}

          <SettingsPanel
            activeSection={activeSection}
            id="agent"
            title={t("sections.agent")}
          >
            {fastModeAvailable ? (
              <FastModeSettingsField
                enabled={draft.fastMode}
                onChange={(fastMode) => {
                  updateDraft((current) => ({ ...current, fastMode }));
                }}
              />
            ) : null}
            <SettingsField label={t("fields.model")}>
              <ModelSelect
                ariaLabel={t("fields.model")}
                models={models}
                onChange={(modelId) => {
                  updateDraft((current) => ({
                    ...current,
                    ...resolveGlobalSettingsModel(models, modelId, current.reasoningEffort),
                  }));
                }}
                value={draft.model}
              />
            </SettingsField>
            <SettingsField label={t("fields.reasoningEffort")}>
              <ReasoningSelect
                ariaLabel={t("fields.reasoningEffort")}
                disabled={selectedModel === undefined}
                model={selectedModel}
                onChange={(reasoningEffort) => {
                  updateDraft((current) => ({ ...current, reasoningEffort }));
                }}
                value={draft.reasoningEffort}
              />
            </SettingsField>
          </SettingsPanel>

          <SettingsPanel
            activeSection={activeSection}
            id="commit"
            title={t("sections.commit")}
          >
            <SettingsField label={t("fields.model")}>
              <ModelSelect
                ariaLabel={t("fields.commitModel")}
                models={models}
                onChange={(modelId) => {
                  updateDraft((current) => ({ ...current, commitMessageModel: modelId }));
                }}
                value={draft.commitMessageModel}
              />
            </SettingsField>
            <SettingsField alignStart label={t("fields.prompt")}>
              <textarea
                aria-label={t("fields.commitMessagePrompt")}
                className="h-28 w-full resize-none rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small text-foreground outline-none focus:border-brand focus:shadow-focus disabled:opacity-50"
                maxLength={4_000}
                onBlur={() => {
                  saveQueue.save(draftRef.current);
                }}
                onChange={(event) => {
                  const commitMessagePrompt = event.currentTarget.value;
                  updateDraft(
                    (current) => ({ ...current, commitMessagePrompt }),
                    true,
                  );
                }}
                value={draft.commitMessagePrompt}
              />
            </SettingsField>
          </SettingsPanel>

        </>
      )}
    </SettingsPageFrame>
  );
}
