import { describe, expect, it, vi } from "vitest";

import {
  formatBingWallpaperDay,
  loadBingWallpaperSource,
} from "./workbench-background.js";
import {
  drawPreprocessedWallpaper,
  getPhysicalWallpaperSize,
  getWallpaperCoverRect,
} from "./workbench-wallpaper-processing.js";

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

describe("Workbench wallpaper preprocessing", () => {
  it("converts the logical viewport to complete physical pixels", () => {
    expect(getPhysicalWallpaperSize(1280.25, 720.2, 2)).toEqual({
      height: 1441,
      width: 2561,
    });
  });

  it("expands the cover drawing outside the canvas for blur sampling", () => {
    expect(getWallpaperCoverRect(1920, 1080, 1000, 1000, 40)).toEqual({
      height: 1080,
      width: 1920,
      x: -460,
      y: -40,
    });
  });

  it("draws the wallpaper once at physical size with a physical blur radius", () => {
    const filters: string[] = [];
    const drawImage = vi.fn();
    const context = {
      drawImage,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      get filter() {
        return filters.at(-1) ?? "none";
      },
      set filter(value: string) {
        filters.push(value);
      },
    };
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      width: 0,
    } as unknown as HTMLCanvasElement;
    const image = {
      naturalHeight: 1080,
      naturalWidth: 1920,
    } as HTMLImageElement;

    expect(
      drawPreprocessedWallpaper(canvas, image, { height: 1000, width: 2000 }, 10, 2),
    ).toBe(true);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1000);
    expect(filters).toContain("blur(20px)");
    expect(filters.at(-1)).toBe("none");
    expect(drawImage).toHaveBeenCalledOnce();
  });
});
