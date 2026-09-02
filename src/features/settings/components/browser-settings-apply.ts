import { changeAppLanguage } from "../../../i18n/i18n.js";
import { setNotificationPreference } from "../notification-preference.js";
import { setThemePreference } from "../theme-preference.js";
import { applyWorkbenchBackgroundPreference } from "../workbench-background-preference.js";

import type { BrowserSettingsChanges } from "./global-settings-save.js";

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
