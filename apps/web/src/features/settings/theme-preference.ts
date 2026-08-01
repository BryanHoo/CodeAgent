export type ThemePreference = "dark" | "light";

const THEME_STORAGE_KEY = "code-agent.theme-preference";
const THEME_STORAGE_VERSION = 1;

type ThemeStorageReader = Readonly<{ getItem: (key: string) => string | null }>;
type ThemeStorageWriter = Readonly<{ setItem: (key: string, value: string) => void }>;
type ThemeRoot = Readonly<{ dataset: Record<string, string | undefined> }>;

export function readThemePreference(storage: ThemeStorageReader): ThemePreference {
  try {
    const value: unknown = JSON.parse(storage.getItem(THEME_STORAGE_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === THEME_STORAGE_VERSION &&
      "theme" in value &&
      (value.theme === "dark" || value.theme === "light")
    ) {
      return value.theme;
    }
  } catch {
    // 本地偏好损坏或不可访问时使用稳定浅色默认值，不阻断应用启动。
  }
  return "light";
}

export function saveThemePreference(theme: ThemePreference, storage: ThemeStorageWriter): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme, version: THEME_STORAGE_VERSION }));
  } catch {
    // 浏览器禁用存储时仍允许当前页面切换主题。
  }
}

export function applyThemePreference(theme: ThemePreference, root: ThemeRoot): void {
  root.dataset["theme"] = theme;
}

export function initializeThemePreference(): ThemePreference {
  const theme = readThemePreference(window.localStorage);
  applyThemePreference(theme, document.documentElement);
  return theme;
}
