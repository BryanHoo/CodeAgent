export type ThemePreference = "auto" | "dark" | "light";

const THEME_STORAGE_KEY = "code-agent.theme-preference";
const THEME_STORAGE_VERSION = 1;
const SYSTEM_DARK_THEME_QUERY = "(prefers-color-scheme: dark)";

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
      (value.theme === "auto" || value.theme === "dark" || value.theme === "light")
    ) {
      return value.theme;
    }
  } catch {
    // 本地偏好损坏或不可访问时跟随系统，不阻断应用启动。
  }
  return "auto";
}

export function saveThemePreference(theme: ThemePreference, storage: ThemeStorageWriter): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme, version: THEME_STORAGE_VERSION }));
  } catch {
    // 浏览器禁用存储时仍允许当前页面切换主题。
  }
}

export function applyThemePreference(
  theme: ThemePreference,
  root: ThemeRoot,
  prefersDark: boolean,
): void {
  root.dataset["theme"] = theme === "auto" ? (prefersDark ? "dark" : "light") : theme;
}

export function initializeThemePreference(): ThemePreference {
  const systemTheme = window.matchMedia(SYSTEM_DARK_THEME_QUERY);
  const theme = readThemePreference(window.localStorage);
  applyThemePreference(theme, document.documentElement, systemTheme.matches);

  // 应用级单一监听器只在自动模式下响应系统主题变化。
  systemTheme.addEventListener("change", () => {
    const currentTheme = readThemePreference(window.localStorage);
    if (currentTheme === "auto") {
      applyThemePreference(currentTheme, document.documentElement, systemTheme.matches);
    }
  });

  return theme;
}
