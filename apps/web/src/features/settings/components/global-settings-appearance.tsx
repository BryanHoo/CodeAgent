import { Monitor, Moon, Sun } from "lucide-react";

import { changeAppLanguage, getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import type { ThemePreference } from "../theme-preference.js";
import {
  SettingsField,
  SettingsPanel,
  SettingsSelect,
  ThemeButton,
  type SettingsSectionId,
} from "./global-settings-fields.js";

export function GlobalSettingsAppearance({
  activeSection,
  onSelectTheme,
  theme,
}: Readonly<{
  activeSection: SettingsSectionId;
  onSelectTheme: (theme: ThemePreference) => void;
  theme: ThemePreference;
}>) {
  const { t } = useTranslation("settings");

  return (
    <SettingsPanel activeSection={activeSection} id="appearance" title={t("sections.appearance")}>
      <SettingsField label={t("appearance.colorMode")}>
        <div className="grid grid-cols-3 rounded-control bg-control p-0.5">
          <ThemeButton
            ariaLabel={t("appearance.autoMode")}
            icon={Monitor}
            label={t("appearance.auto")}
            onClick={() => {
              onSelectTheme("auto");
            }}
            selected={theme === "auto"}
          />
          <ThemeButton
            ariaLabel={t("appearance.lightMode")}
            icon={Sun}
            label={t("appearance.light")}
            onClick={() => {
              onSelectTheme("light");
            }}
            selected={theme === "light"}
          />
          <ThemeButton
            ariaLabel={t("appearance.darkMode")}
            icon={Moon}
            label={t("appearance.dark")}
            onClick={() => {
              onSelectTheme("dark");
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
  );
}
