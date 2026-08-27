import { describe, expect, it, vi } from "vitest";

import {
  formatBingWallpaperDay,
  loadBingWallpaperSource,
} from "./workbench-background.js";

describe("Workbench Bing background", () => {
  it("loads the local-day wallpaper through the native client", async () => {
    const getWorkbenchBackground = vi.fn(async () => ({ assetPath: "/cache/bing.jpg" }));
    const toAssetUrl = vi.fn((path: string) => `asset://localhost${path}`);

    await expect(
      loadBingWallpaperSource(
        new Date(2026, 7, 25, 23, 59, 59),
        { getWorkbenchBackground },
        toAssetUrl,
      ),
    ).resolves.toBe("asset://localhost/cache/bing.jpg");
    expect(getWorkbenchBackground).toHaveBeenCalledWith("2026-08-25");
    expect(toAssetUrl).toHaveBeenCalledWith("/cache/bing.jpg");
  });

  it("formats the day without depending on UTC", () => {
    expect(formatBingWallpaperDay(new Date(2026, 0, 2, 23, 30))).toBe("2026-01-02");
  });
});
