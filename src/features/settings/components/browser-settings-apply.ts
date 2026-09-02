import { changeAppLanguage } from "../../../i18n/i18n.js";
import type { SupportedLanguage } from "../../../i18n/language-preference.js";
import { setNotificationPreference } from "../notification-preference.js";
import { setThemePreference, type ThemePreference } from "../theme-preference.js";
import {
  applyWorkbenchBackgroundPreference,
  type CustomBackgroundMutation,
  type WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";

export type BrowserSettingsChanges = Readonly<{
  background?: WorkbenchBackgroundPreference;
  customBackgroundMutation?: CustomBackgroundMutation;
  language?: SupportedLanguage;
  notificationsEnabled?: boolean;
  theme?: ThemePreference;
}>;

export async function applyBrowserSettingsChanges(
  changes: BrowserSettingsChanges,
): Promise<void> {
  if (changes.background !== undefined && changes.customBackgroundMutation !== undefined) {
    await applyWorkbenchBackgroundPreference(
      changes.background,
      changes.customBackgroundMutation,
    );
  }
  if (changes.theme !== undefined && typeof window !== "undefined") {
    setThemePreference(changes.theme);
  }
  if (changes.notificationsEnabled !== undefined) {
    setNotificationPreference(changes.notificationsEnabled);
  }
  if (changes.language !== undefined) {
    await changeAppLanguage(changes.language);
  }
}
