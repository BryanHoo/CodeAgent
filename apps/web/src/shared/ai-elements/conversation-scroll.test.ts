import { describe, expect, it, vi } from "vitest";

import { createConversationAutoScrollController } from "./conversation-scroll.js";

type ScrollTarget = Parameters<
  ReturnType<typeof createConversationAutoScrollController>["handleScroll"]
>[0];

function createScrollTarget({
  clientHeight = 400,
  scrollHeight = 1_000,
  scrollTop = 600,
}: {
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
} = {}) {
  return {
    clientHeight,
    scrollHeight,
    scrollTo: vi.fn(),
    scrollTop,
  } satisfies ScrollTarget;
}

describe("conversation auto scroll", () => {
  it("follows new content while the user remains at the bottom", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget({ scrollHeight: 1_200 });

    controller.handleContentResize(scrollTarget);

    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_200 });
    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
  });

  it("does not mistake a large content height increase for a user scroll", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget();

    controller.handleContentResize(scrollTarget);
    scrollTarget.scrollTo.mockClear();

    // 大段回复可能先触发 scroll，再触发 ResizeObserver，此时旧 scrollTop 会暂时远离底部。
    scrollTarget.scrollHeight = 1_800;
    controller.handleScroll(scrollTarget);
    controller.handleContentResize(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_800 });
  });

  it("pauses after the user scrolls away and resumes after they return to the bottom", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget({ scrollTop: 300 });

    controller.handleScroll(scrollTarget);
    scrollTarget.scrollHeight = 1_200;
    controller.handleContentResize(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(false);
    expect(scrollTarget.scrollTo).not.toHaveBeenCalled();

    scrollTarget.scrollTop = 780;
    controller.handleScroll(scrollTarget);
    controller.handleContentResize(scrollTarget);

    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1_200 });
  });

  it("resumes following when explicitly scrolling back to the bottom", () => {
    const onAtBottomChange = vi.fn();
    const controller = createConversationAutoScrollController(onAtBottomChange);
    const scrollTarget = createScrollTarget({ scrollTop: 200 });

    controller.handleScroll(scrollTarget);
    controller.scrollToBottom(scrollTarget);

    expect(scrollTarget.scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 1_000 });
    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
  });
});
