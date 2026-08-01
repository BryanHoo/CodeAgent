import { describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
} from "./theme-preference.js";

describe("theme preference", () => {
  it("reads the versioned preference and falls back to light for invalid data", () => {
    expect(readThemePreference({ getItem: () => '{"theme":"dark","version":1}' })).toBe("dark");
    expect(readThemePreference({ getItem: () => '{"theme":"system","version":1}' })).toBe("light");
    expect(readThemePreference({ getItem: () => "broken" })).toBe("light");
  });

  it("persists and applies the selected theme", () => {
    const setItem = vi.fn();
    const root = { dataset: {} as Record<string, string | undefined> };

    saveThemePreference("dark", { setItem });
    applyThemePreference("dark", root);

    expect(setItem).toHaveBeenCalledWith(
      "code-agent.theme-preference",
      '{"theme":"dark","version":1}',
    );
    expect(root.dataset["theme"]).toBe("dark");
  });
});
