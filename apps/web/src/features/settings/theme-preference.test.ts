import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  initializeThemePreference,
  readThemePreference,
  saveThemePreference,
} from "./theme-preference.js";

describe("theme preference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads all versioned preferences and defaults to auto", () => {
    expect(readThemePreference({ getItem: () => null })).toBe("auto");
    expect(readThemePreference({ getItem: () => '{"theme":"auto","version":1}' })).toBe("auto");
    expect(readThemePreference({ getItem: () => '{"theme":"dark","version":1}' })).toBe("dark");
    expect(readThemePreference({ getItem: () => '{"theme":"light","version":1}' })).toBe("light");
    expect(readThemePreference({ getItem: () => "broken" })).toBe("auto");
  });

  it("persists preferences and resolves auto to the current system theme", () => {
    const setItem = vi.fn();
    const root = { dataset: {} as Record<string, string | undefined> };

    saveThemePreference("auto", { setItem });
    applyThemePreference("auto", root, false);

    expect(setItem).toHaveBeenCalledWith(
      "code-agent.theme-preference",
      '{"theme":"auto","version":1}',
    );
    expect(root.dataset["theme"]).toBe("light");

    applyThemePreference("auto", root, true);
    expect(root.dataset["theme"]).toBe("dark");
  });

  it("follows system changes only while auto is selected", () => {
    let storedTheme = '{"theme":"auto","version":1}';
    let prefersDark = false;
    let onChange: (() => void) | undefined;
    const root = { dataset: {} as Record<string, string | undefined> };
    const media = {
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        onChange = listener;
      }),
      get matches() {
        return prefersDark;
      },
    };

    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("window", {
      localStorage: { getItem: () => storedTheme },
      matchMedia: vi.fn(() => media),
    });

    expect(initializeThemePreference()).toBe("auto");
    expect(root.dataset["theme"]).toBe("light");
    expect(media.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    prefersDark = true;
    onChange?.();
    expect(root.dataset["theme"]).toBe("dark");

    storedTheme = '{"theme":"light","version":1}';
    root.dataset["theme"] = "light";
    onChange?.();
    expect(root.dataset["theme"]).toBe("light");
  });
});
