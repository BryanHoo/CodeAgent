import { describe, expect, it, vi } from "vitest";

import {
  measureConversationTurn,
  resizeConversationTurn,
  shouldAdjustConversationScrollPositionOnItemSizeChange,
  shouldDeferConversationTurnResize,
} from "./conversation-measurement.js";

describe("measureConversationTurn", () => {
  it("reads the latest DOM height when recovery runs without a ResizeObserver entry", () => {
    const element = { offsetHeight: 960 };

    expect(measureConversationTurn(element as HTMLElement)).toBe(960);

    element.offsetHeight = 144;
    expect(measureConversationTurn(element as HTMLElement)).toBe(144);
  });

  it("uses the precomputed border box size during ResizeObserver delivery", () => {
    const element = {
      get offsetHeight(): number {
        throw new Error("offsetHeight should not be read during ResizeObserver delivery");
      },
    } as HTMLElement;
    const entry = {
      borderBoxSize: [{ blockSize: 144.4 }],
    } as unknown as ResizeObserverEntry;

    expect(measureConversationTurn(element, entry)).toBe(144);
  });

  it("writes the latest DOM height directly to the virtualizer recovery path", () => {
    const resizeItem = vi.fn();
    const element = {
      dataset: { index: "3" },
      offsetHeight: 144,
    } as unknown as HTMLElement;

    resizeConversationTurn(element, resizeItem);

    expect(resizeItem).toHaveBeenCalledWith(3, 144);
  });

  it("compensates a resized turn that ends above the viewport", () => {
    const shouldAdjust = shouldAdjustConversationScrollPositionOnItemSizeChange(
      { end: 1_100 },
      580,
      { scrollAdjustments: 0, scrollOffset: 1_200 },
    );

    expect(shouldAdjust).toBe(true);
  });

  it("does not compensate a resized turn at or below the viewport start", () => {
    const shouldAdjust = shouldAdjustConversationScrollPositionOnItemSizeChange(
      { end: 1_300 },
      580,
      { scrollAdjustments: 0, scrollOffset: 1_200 },
    );

    expect(shouldAdjust).toBe(false);
  });

  it("does not compensate a collapsing turn that still covers the viewport", () => {
    const coveringTurn = { end: 5_000, start: 1_000 };
    const shouldAdjust = shouldAdjustConversationScrollPositionOnItemSizeChange(
      coveringTurn,
      -4_800,
      { scrollAdjustments: 0, scrollOffset: 1_200 },
    );

    expect(shouldAdjust).toBe(false);
  });

  it("defers an above-viewport resize while the user scrolls backward", () => {
    const shouldDefer = shouldDeferConversationTurnResize(
      { end: 1_100, start: 1_000 },
      180,
      {
        isScrolling: true,
        scrollAdjustments: 0,
        scrollDirection: "backward",
        scrollOffset: 1_200,
      },
    );

    expect(shouldDefer).toBe(true);
  });

  it("applies the same resize immediately after backward scrolling settles", () => {
    const shouldDefer = shouldDeferConversationTurnResize(
      { end: 1_100, start: 1_000 },
      180,
      {
        isScrolling: false,
        scrollAdjustments: 0,
        scrollDirection: "backward",
        scrollOffset: 1_200,
      },
    );

    expect(shouldDefer).toBe(false);
  });

  it("does not defer an above-viewport resize while scrolling forward", () => {
    const shouldDefer = shouldDeferConversationTurnResize(
      { end: 1_100, start: 1_000 },
      180,
      {
        isScrolling: true,
        scrollAdjustments: 0,
        scrollDirection: "forward",
        scrollOffset: 1_200,
      },
    );

    expect(shouldDefer).toBe(false);
  });

  it("applies a collapse immediately when it removes the content under the viewport", () => {
    const shouldDefer = shouldDeferConversationTurnResize(
      { end: 5_000, start: 1_000 },
      100,
      {
        isScrolling: true,
        scrollAdjustments: 0,
        scrollDirection: "backward",
        scrollOffset: 1_200,
      },
    );

    expect(shouldDefer).toBe(false);
  });
});
