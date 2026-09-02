import type { AgentGlobalSettings } from "@/protocol/index.js";

import type { SupportedLanguage } from "../../../i18n/language-preference.js";
import type { ThemePreference } from "../theme-preference.js";
import type {
  CustomBackgroundMutation,
  WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";

export type BrowserSettingsDraft = Readonly<{
  background: WorkbenchBackgroundPreference;
  customBackgroundMutation: CustomBackgroundMutation;
  language: SupportedLanguage;
  notificationsEnabled: boolean;
  theme: ThemePreference;
}>;

export type BrowserSettingsChanges = Readonly<
  Partial<Omit<BrowserSettingsDraft, "customBackgroundMutation">> & {
    customBackgroundMutation?: CustomBackgroundMutation;
  }
>;

type SaveGlobalSettingsDependencies = Readonly<{
  applyBrowserSettings: (changes: BrowserSettingsChanges) => Promise<void> | void;
  saveGlobalSettings: (settings: AgentGlobalSettings) => Promise<void>;
}>;

export async function saveGlobalSettingsDraft(
  initialGlobalSettings: AgentGlobalSettings,
  initialBrowserSettings: BrowserSettingsDraft,
  nextGlobalSettings: AgentGlobalSettings,
  nextBrowserSettings: BrowserSettingsDraft,
  dependencies: SaveGlobalSettingsDependencies,
): Promise<void> {
  const globalChanged = JSON.stringify(initialGlobalSettings) !== JSON.stringify(nextGlobalSettings);
  if (globalChanged) {
    await dependencies.saveGlobalSettings(nextGlobalSettings);
  }

  const browserChanges = changedBrowserSettings(initialBrowserSettings, nextBrowserSettings);
  if (Object.keys(browserChanges).length > 0) {
    // 浏览器偏好只在原子服务端保存成功后提交，失败时不产生局部副作用。
    await dependencies.applyBrowserSettings(browserChanges);
  }
}

function changedBrowserSettings(
  initial: BrowserSettingsDraft,
  next: BrowserSettingsDraft,
): BrowserSettingsChanges {
  const changes: {
    background?: WorkbenchBackgroundPreference;
    customBackgroundMutation?: CustomBackgroundMutation;
    language?: SupportedLanguage;
    notificationsEnabled?: boolean;
    theme?: ThemePreference;
  } = {};
  const backgroundAssetsChanged =
    next.customBackgroundMutation.deletedImageIds.length > 0 ||
    next.customBackgroundMutation.imagesToSave.length > 0;
  if (
    JSON.stringify(initial.background) !== JSON.stringify(next.background) ||
    backgroundAssetsChanged
  ) {
    changes.background = next.background;
    changes.customBackgroundMutation = next.customBackgroundMutation;
  }
  if (initial.language !== next.language) changes.language = next.language;
  if (initial.notificationsEnabled !== next.notificationsEnabled) {
    changes.notificationsEnabled = next.notificationsEnabled;
  }
  if (initial.theme !== next.theme) changes.theme = next.theme;
  return changes;
}
