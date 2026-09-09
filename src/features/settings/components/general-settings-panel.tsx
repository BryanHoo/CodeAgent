import type { AgentGlobalSettings, ProjectOpenApp } from "@/protocol/index.js";
import "../../../i18n/settings-general.js";
import { MonitorCog, Moon, Sun } from "lucide-react";
import { useId, type ReactNode } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import type { SupportedLanguage } from "../../../i18n/language-preference.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import type { ThemePreference } from "../theme-preference.js";
import { SettingsField, SettingsSelect, type SettingsSectionId } from "./global-settings-fields.js";
import { deriveApprovalMode, type ApprovalMode } from "./global-settings-model.js";

const themeOptions = [
  { value: "system", icon: MonitorCog, label: "automatic", aria: "automaticMode" },
  { value: "light", icon: Sun, label: "light", aria: "lightMode" },
  { value: "dark", icon: Moon, label: "dark", aria: "darkMode" },
] as const;

function SettingsGroup({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 className="mb-3 text-body font-semibold" id={id}>{title}</h2>
      <div className="divide-y divide-separator border-y border-separator">{children}</div>
    </section>
  );
}

export function GeneralSettingsPanel({
  activeSection, apps, settings, language, notificationsEnabled, theme,
  onApprovalModeChange, onSandboxChange, onFollowUpChange, onDefaultOpenAppChange,
  onLanguageChange, onNotificationsChange, onThemeChange,
}: Readonly<{
  activeSection: SettingsSectionId;
  apps: readonly ProjectOpenApp[];
  settings: AgentGlobalSettings;
  language: SupportedLanguage;
  notificationsEnabled: boolean;
  theme: ThemePreference;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  onSandboxChange: (mode: AgentGlobalSettings["sandboxMode"]) => void;
  onFollowUpChange: (behavior: AgentGlobalSettings["followUpBehavior"]) => void;
  onDefaultOpenAppChange: (appId: AgentGlobalSettings["defaultOpenAppId"]) => void;
  onLanguageChange: (language: SupportedLanguage) => void;
  onNotificationsChange: (enabled: boolean) => void;
  onThemeChange: (theme: ThemePreference) => void;
}>) {
  const { t } = useTranslation("settings");
  if (activeSection !== "appearance") return null;
  return (
    <section id="settings-panel-appearance">
      <h1 className="mb-9 text-title font-semibold">{t("sections.appearance")}</h1>
      <div className="space-y-8">
        <SettingsGroup title={t("general.permissions")}>
          <SettingsField label={t("fields.approvalPolicy")} description={t("general.approvalDescription")}>
            <SettingsSelect aria-label={t("fields.approvalPolicy")} value={deriveApprovalMode(settings)} onChange={(event) => onApprovalModeChange(event.currentTarget.value as ApprovalMode)}>
              <option value="on-request">{t("approval.onRequest")}</option>
              <option value="auto-review">{t("approval.autoReview")}</option>
              <option value="never">{t("approval.never")}</option>
            </SettingsSelect>
          </SettingsField>
          <SettingsField label={t("fields.sandbox")} description={t("general.sandboxDescription")}>
            <SettingsSelect aria-label={t("fields.sandbox")} value={settings.sandboxMode} onChange={(event) => onSandboxChange(event.currentTarget.value as AgentGlobalSettings["sandboxMode"])}>
              <option value="read-only">{t("sandbox.readOnly")}</option>
              <option value="workspace-write">{t("sandbox.workspaceWrite")}</option>
              <option value="danger-full-access">{t("sandbox.dangerFullAccess")}</option>
            </SettingsSelect>
          </SettingsField>
        </SettingsGroup>
        <SettingsGroup title={t("general.preferences")}>
          <SettingsField label={t("fields.defaultOpenWith")} description={t("general.openAppDescription")}>
            <SettingsSelect aria-label={t("fields.defaultOpenWith")} value={settings.defaultOpenAppId ?? ""} onChange={(event) => onDefaultOpenAppChange((event.currentTarget.value || null) as AgentGlobalSettings["defaultOpenAppId"])}>
              <option value="">{t("appearance.defaultOpenAutomatic")}</option>
              {apps.filter((app) => app.kind !== "system-default").map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
            </SettingsSelect>
          </SettingsField>
          <SettingsField label={t("appearance.language")} description={t("general.languageDescription")}>
            <SettingsSelect aria-label={t("appearance.language")} value={language} onChange={(event) => onLanguageChange(event.currentTarget.value as SupportedLanguage)}>
              <option value="zh-CN">{t("languages.zhCN")}</option>
              <option value="en">{t("languages.en")}</option>
            </SettingsSelect>
          </SettingsField>
          <SettingsField label={t("appearance.colorMode")} description={t("general.themeDescription")}>
            <div className="grid w-40 grid-cols-3 rounded-control bg-control p-0.5" role="group" aria-label={t("appearance.colorMode")}>
              {themeOptions.map(({ value, icon: Icon, label, aria }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <Button aria-label={t(`appearance.${aria}`)} aria-pressed={theme === value} className={`h-8 min-w-0 px-2 ${theme === value ? "bg-raised text-foreground shadow-control" : "text-muted-foreground"}`} variant="ghost" type="button" onClick={() => onThemeChange(value)}>
                      <Icon aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t(`appearance.${label}`)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </SettingsField>
        </SettingsGroup>
        <SettingsGroup title={t("general.editor")}>
          <SettingsField label={t("fields.followUpMessages")} description={t("general.followUpDescription")}>
            <div className="grid w-40 grid-cols-2 rounded-control bg-control p-0.5" role="group" aria-label={t("fields.followUpMessages")}>
              {(["queue", "steer"] as const).map((value) => (
                <Button key={value} aria-pressed={settings.followUpBehavior === value} className={`h-8 px-3 text-body-small ${settings.followUpBehavior === value ? "bg-raised text-foreground shadow-control" : "text-muted-foreground"}`} variant="ghost" type="button" onClick={() => onFollowUpChange(value)}>{t(`followUp.${value}`)}</Button>
              ))}
            </div>
          </SettingsField>
        </SettingsGroup>
        <SettingsGroup title={t("appearance.notifications")}>
          <SettingsField label={t("general.taskNotifications")} description={t("general.notificationsDescription")}>
            <Button role="switch" aria-label={t("general.taskNotifications")} aria-checked={notificationsEnabled} className={`h-6 w-10 rounded-pill p-0.5 ${notificationsEnabled ? "bg-brand hover:bg-brand" : "bg-control-hover"}`} variant="ghost" type="button" onClick={() => onNotificationsChange(!notificationsEnabled)}>
              <span aria-hidden="true" className={`block size-5 rounded-pill bg-brand-contrast shadow-control transition-transform motion-reduce:transition-none ${notificationsEnabled ? "translate-x-2" : "-translate-x-2"}`} />
            </Button>
          </SettingsField>
        </SettingsGroup>
      </div>
    </section>
  );
}
