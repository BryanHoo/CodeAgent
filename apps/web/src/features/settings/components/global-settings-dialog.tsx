import type {
  AgentGlobalSettings,
  AgentModel,
  AgentProjectDefaults,
  ProjectOpenApp,
} from "@code-agent/protocol";
import {
  Bot,
  ChevronDown,
  GitCommitHorizontal,
  MonitorCog,
  Moon,
  Palette,
  Settings,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type SelectHTMLAttributes } from "react";

import { PromptInputSelect } from "../../../shared/ai-elements/prompt-input.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { changeAppLanguage, getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import {
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../theme-preference.js";

type ApprovalMode = AgentGlobalSettings["approvalPolicy"] | "auto-review";
type SettingsSectionId = "agent" | "appearance" | "commit" | "integration";

const settingsSections: readonly Readonly<{
  icon: LucideIcon;
  id: SettingsSectionId;
}>[] = [
  { icon: Palette, id: "appearance" },
  { icon: Bot, id: "agent" },
  { icon: GitCommitHorizontal, id: "commit" },
  { icon: MonitorCog, id: "integration" },
];

export function resolveGlobalSettingsModel(
  models: readonly AgentModel[],
  modelId: string,
  requestedEffort: string,
): Pick<AgentProjectDefaults, "model" | "reasoningEffort"> {
  const model = models.find((item) => item.id === modelId);
  if (model === undefined) {
    return { model: modelId, reasoningEffort: requestedEffort };
  }
  const reasoningEffort = model.supportedReasoningEfforts.some(
    (effort) => effort.id === requestedEffort,
  )
    ? requestedEffort
    : model.defaultReasoningEffort;
  return { model: model.id, reasoningEffort };
}

function deriveApprovalMode(settings: AgentGlobalSettings): ApprovalMode {
  return settings.approvalsReviewer === "auto_review" ? "auto-review" : settings.approvalPolicy;
}

function applyApprovalMode(settings: AgentGlobalSettings, mode: ApprovalMode): AgentGlobalSettings {
  // 自动审批由 on-request 与 auto_review 共同表达，不能映射为权限更宽的 never。
  return mode === "auto-review"
    ? { ...settings, approvalPolicy: "on-request", approvalsReviewer: "auto_review" }
    : { ...settings, approvalPolicy: mode, approvalsReviewer: "user" };
}

function createFallbackSettings(models: readonly AgentModel[]): AgentGlobalSettings {
  const model = models.find((item) => item.isDefault) ?? models[0];
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    commitMessageModel: model?.id ?? "",
    commitMessagePrompt: "",
    commitMessageReasoningEffort: model?.defaultReasoningEffort ?? "",
    defaultOpenAppId: null,
    followUpBehavior: "queue",
    model: model?.id ?? "",
    reasoningEffort: model?.defaultReasoningEffort ?? "",
    sandboxMode: "workspace-write",
  };
}

function readInitialTheme(): ThemePreference {
  return typeof window === "undefined" ? "light" : readThemePreference(window.localStorage);
}

type GlobalSettingsDialogProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  error: Error | null;
  isPending: boolean;
  models: readonly AgentModel[];
  onClose: () => void;
  onRetry: () => unknown;
  onSave: (settings: AgentGlobalSettings) => Promise<void>;
  settings?: AgentGlobalSettings;
}>;

export function GlobalSettingsDialog({
  apps,
  error,
  isPending,
  models,
  onClose,
  onRetry,
  onSave,
  settings,
}: GlobalSettingsDialogProps) {
  const { t } = useTranslation("settings");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saveLockRef = useRef(createAsyncActionLock());
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const [draft, setDraft] = useState<AgentGlobalSettings>(
    () => settings ?? createFallbackSettings(models),
  );
  const [theme, setTheme] = useState<ThemePreference>(readInitialTheme);
  const [saveError, setSaveError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const selectedModel = models.find((model) => model.id === draft.model);
  const selectedCommitModel = models.find((model) => model.id === draft.commitMessageModel);

  useEffect(() => {
    if (settings !== undefined) {
      setDraft(settings);
    }
  }, [settings]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      // 原生 dialog 统一负责焦点圈定和 Escape 行为。
      dialog.showModal();
    }
  }, []);

  const close = () => {
    if (!isSaving) {
      onClose();
    }
  };

  const selectTheme = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    // 外观偏好属于浏览器本地状态，选择后立即应用，不依赖服务端保存。
    if (typeof window !== "undefined") {
      saveThemePreference(nextTheme, window.localStorage);
      applyThemePreference(nextTheme, document.documentElement);
    }
  };

  return (
    // 原生 dialog 已通过 onCancel 提供 Escape 行为，onClick 仅识别不可聚焦的 backdrop。
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      aria-labelledby="global-settings-title"
      className="m-auto h-[min(88vh,38rem)] w-[min(94vw,54rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
      ref={dialogRef}
    >
      <form
        className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (settings === undefined || isPending || isSaving) {
            return;
          }
          void saveLockRef.current.run(async () => {
            setSaveError(false);
            setIsSaving(true);
            try {
              await onSave(draft);
              onClose();
            } catch {
              setSaveError(true);
            } finally {
              setIsSaving(false);
            }
          });
        }}
      >
        <header className="flex h-12 items-center gap-2.5 px-4 shadow-toolbar">
          <Settings className="size-4 text-accent" aria-hidden="true" />
          <h2
            className="min-w-0 flex-1 truncate text-heading font-semibold"
            id="global-settings-title"
          >
            {t("title")}
          </h2>
          <button
            aria-label={t("actions.closeDialog")}
            className="inline-grid size-8 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus disabled:opacity-50"
            disabled={isSaving}
            onClick={close}
            title={t("actions.close")}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[var(--ui-layout-settings-sidebar-width)_minmax(0,1fr)] sm:grid-rows-1">
          <aside className="min-w-0 bg-control px-2 py-2 sm:px-3 sm:py-4 sm:shadow-divider">
            <nav
              aria-label={t("navigationLabel")}
              className="flex min-w-0 gap-1 overflow-x-auto sm:flex-col sm:overflow-visible"
            >
              {settingsSections.map((section) => {
                const Icon = section.icon;
                const selected = activeSection === section.id;
                return (
                  <button
                    aria-controls={`settings-panel-${section.id}`}
                    aria-current={selected ? "page" : undefined}
                    className={`flex h-9 shrink-0 items-center gap-2 rounded-control px-2.5 text-left text-body-small font-medium transition-colors focus-visible:shadow-focus sm:w-full ${selected ? "bg-accent text-white shadow-control" : "text-muted-foreground hover:bg-control-hover hover:text-foreground"}`}
                    key={section.id}
                    onClick={() => {
                      setActiveSection(section.id);
                    }}
                    type="button"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span>{t(`sections.${section.id}`)}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {error !== null ? (
              <div
                className="flex min-h-40 flex-col items-center justify-center gap-3"
                role="alert"
              >
                <p className="text-body-small text-danger">{t("errors.load")}</p>
                <button
                  className="h-8 rounded-control bg-control px-3 text-body-small font-medium hover:bg-control-hover"
                  onClick={() => void onRetry()}
                  type="button"
                >
                  {t("common:actions.retry")}
                </button>
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
                <SettingsPanel
                  activeSection={activeSection}
                  id="appearance"
                  title={t("sections.appearance")}
                >
                  <SettingsField label={t("appearance.colorMode")}>
                    <div className="grid grid-cols-2 rounded-control bg-control p-0.5">
                      <ThemeButton
                        ariaLabel={t("appearance.lightMode")}
                        icon={Sun}
                        label={t("appearance.light")}
                        onClick={() => {
                          selectTheme("light");
                        }}
                        selected={theme === "light"}
                      />
                      <ThemeButton
                        ariaLabel={t("appearance.darkMode")}
                        icon={Moon}
                        label={t("appearance.dark")}
                        onClick={() => {
                          selectTheme("dark");
                        }}
                        selected={theme === "dark"}
                      />
                    </div>
                  </SettingsField>
                  <SettingsField label={t("appearance.language")}>
                    <SettingsSelect
                      aria-label={t("appearance.language")}
                      onChange={(event) => {
                        void changeAppLanguage(event.currentTarget.value as "en" | "zh-CN");
                      }}
                      value={getCurrentLanguage()}
                    >
                      <option value="zh-CN">{t("languages.zhCN")}</option>
                      <option value="en">{t("languages.en")}</option>
                    </SettingsSelect>
                  </SettingsField>
                </SettingsPanel>

                <SettingsPanel activeSection={activeSection} id="agent" title={t("sections.agent")}>
                  <SettingsField label={t("fields.approvalPolicy")}>
                    <SettingsSelect
                      aria-label={t("fields.approvalPolicy")}
                      disabled={isSaving}
                      onChange={(event) => {
                        const mode = event.currentTarget.value as ApprovalMode;
                        setDraft((current) => applyApprovalMode(current, mode));
                      }}
                      value={deriveApprovalMode(draft)}
                    >
                      <option value="untrusted">{t("approval.untrusted")}</option>
                      <option value="on-request">{t("approval.onRequest")}</option>
                      <option value="auto-review">{t("approval.autoReview")}</option>
                      <option value="never">{t("approval.never")}</option>
                    </SettingsSelect>
                  </SettingsField>
                  <SettingsField label={t("fields.sandbox")}>
                    <SettingsSelect
                      aria-label={t("fields.sandbox")}
                      disabled={isSaving}
                      onChange={(event) => {
                        const sandboxMode = event.currentTarget
                          .value as AgentGlobalSettings["sandboxMode"];
                        setDraft((current) => ({ ...current, sandboxMode }));
                      }}
                      value={draft.sandboxMode}
                    >
                      <option value="read-only">{t("sandbox.readOnly")}</option>
                      <option value="workspace-write">{t("sandbox.workspaceWrite")}</option>
                      <option value="danger-full-access">{t("sandbox.dangerFullAccess")}</option>
                    </SettingsSelect>
                  </SettingsField>
                  <SettingsField label={t("fields.followUpMessages")}>
                    <SettingsSelect
                      aria-label={t("fields.followUpMessages")}
                      disabled={isSaving}
                      onChange={(event) => {
                        const followUpBehavior = event.currentTarget
                          .value as AgentGlobalSettings["followUpBehavior"];
                        setDraft((current) => ({ ...current, followUpBehavior }));
                      }}
                      value={draft.followUpBehavior}
                    >
                      <option value="queue">{t("followUp.queue")}</option>
                      <option value="steer">{t("followUp.steer")}</option>
                    </SettingsSelect>
                  </SettingsField>
                  <SettingsField label={t("fields.model")}>
                    <ModelSelect
                      ariaLabel={t("fields.model")}
                      disabled={isSaving}
                      models={models}
                      onChange={(modelId) => {
                        setDraft((current) => ({
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
                      disabled={isSaving || selectedModel === undefined}
                      model={selectedModel}
                      onChange={(reasoningEffort) => {
                        setDraft((current) => ({ ...current, reasoningEffort }));
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
                      disabled={isSaving}
                      models={models}
                      onChange={(modelId) => {
                        setDraft((current) => {
                          const next = resolveGlobalSettingsModel(
                            models,
                            modelId,
                            current.commitMessageReasoningEffort,
                          );
                          return {
                            ...current,
                            commitMessageModel: next.model,
                            commitMessageReasoningEffort: next.reasoningEffort,
                          };
                        });
                      }}
                      value={draft.commitMessageModel}
                    />
                  </SettingsField>
                  <SettingsField label={t("fields.reasoningEffort")}>
                    <ReasoningSelect
                      ariaLabel={t("fields.commitReasoningEffort")}
                      disabled={isSaving || selectedCommitModel === undefined}
                      model={selectedCommitModel}
                      onChange={(commitMessageReasoningEffort) => {
                        setDraft((current) => ({ ...current, commitMessageReasoningEffort }));
                      }}
                      value={draft.commitMessageReasoningEffort}
                    />
                  </SettingsField>
                  <SettingsField alignStart label={t("fields.prompt")}>
                    <textarea
                      aria-label={t("fields.commitMessagePrompt")}
                      className="h-28 w-full resize-none rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small text-foreground outline-none focus:border-accent focus:shadow-focus disabled:opacity-50"
                      disabled={isSaving}
                      maxLength={4_000}
                      onChange={(event) => {
                        const commitMessagePrompt = event.currentTarget.value;
                        setDraft((current) => ({ ...current, commitMessagePrompt }));
                      }}
                      value={draft.commitMessagePrompt}
                    />
                  </SettingsField>
                </SettingsPanel>

                <SettingsPanel
                  activeSection={activeSection}
                  id="integration"
                  title={t("sections.integration")}
                >
                  <SettingsField label={t("fields.defaultOpenWith")}>
                    <SettingsSelect
                      aria-label={t("fields.defaultOpenWith")}
                      disabled={isSaving}
                      onChange={(event) => {
                        const appId = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          defaultOpenAppId:
                            appId === ""
                              ? null
                              : (appId as AgentGlobalSettings["defaultOpenAppId"]),
                        }));
                      }}
                      value={draft.defaultOpenAppId ?? ""}
                    >
                      <option value="">{t("integration.automatic")}</option>
                      {apps
                        .filter((app) => app.kind !== "system-default")
                        .map((app) => (
                          <option key={app.id} value={app.id}>
                            {app.name}
                          </option>
                        ))}
                    </SettingsSelect>
                  </SettingsField>
                </SettingsPanel>
              </>
            )}
          </div>
        </div>

        <footer className="flex min-h-14 items-center justify-end gap-2 px-4 shadow-[0_-1px_0_var(--ui-color-separator)] sm:px-5">
          {saveError ? (
            <p className="mr-auto text-meta text-danger" role="alert">
              {t("errors.save")}
            </p>
          ) : null}
          <button
            className="h-8 rounded-control px-3 text-body-small text-muted-foreground hover:bg-control-hover hover:text-foreground disabled:opacity-50"
            disabled={isSaving}
            onClick={close}
            type="button"
          >
            {t("actions.cancel")}
          </button>
          <button
            className="h-8 rounded-control bg-accent px-3 text-body-small font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            disabled={isPending || isSaving || settings === undefined}
            type="submit"
          >
            {isSaving ? t("actions.saving") : t("actions.save")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function SettingsPanel({
  activeSection,
  children,
  id,
  title,
}: Readonly<{
  activeSection: SettingsSectionId;
  children: React.ReactNode;
  id: SettingsSectionId;
  title: string;
}>) {
  return (
    <section hidden={activeSection !== id} id={`settings-panel-${id}`}>
      <h3 className="mb-4 text-heading font-semibold">{title}</h3>
      <div className="divide-y divide-separator">{children}</div>
    </section>
  );
}

function SettingsField({
  alignStart = false,
  children,
  label,
}: Readonly<{
  alignStart?: boolean;
  children: React.ReactNode;
  label: string;
}>) {
  return (
    <div
      className={`grid min-h-16 gap-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] ${alignStart ? "items-start" : "items-center"}`}
    >
      <span className={`text-body-small font-medium text-foreground ${alignStart ? "pt-2" : ""}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

function ThemeButton({
  ariaLabel,
  icon: Icon,
  label,
  onClick,
  selected,
}: Readonly<{
  ariaLabel: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  selected: boolean;
}>) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={`inline-flex h-8 items-center justify-center gap-2 rounded-[5px] text-body-small font-medium transition-colors ${selected ? "bg-raised text-foreground shadow-control" : "text-muted-foreground hover:text-foreground"}`}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4" />
      <span>{label}</span>
    </button>
  );
}

function ModelSelect({
  ariaLabel,
  disabled,
  models,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  models: readonly AgentModel[];
  onChange: (modelId: string) => void;
  value: string;
}>) {
  return (
    <SettingsSelect
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      value={value}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.displayName}
        </option>
      ))}
    </SettingsSelect>
  );
}

function ReasoningSelect({
  ariaLabel,
  disabled,
  model,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  model: AgentModel | undefined;
  onChange: (effort: string) => void;
  value: string;
}>) {
  const { t } = useTranslation("settings");
  return (
    <SettingsSelect
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      value={value}
    >
      {model?.supportedReasoningEfforts.map((effort) => (
        <option key={effort.id} value={effort.id}>
          {t(`effort.${effort.id}`, { defaultValue: effort.id })}
        </option>
      ))}
    </SettingsSelect>
  );
}

function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <PromptInputSelect
        className="h-9 w-full max-w-none !border !border-separator-strong !bg-control px-2.5 pr-8 text-body-small text-foreground"
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
