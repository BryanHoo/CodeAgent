import { describe, expect, it, vi } from "vitest";

import {
  createConversationAutoScrollController,
  scheduleConversationLayoutRecovery,
  type ConversationScrollTarget,
} from "./conversation-scroll.js";

function createScrollTarget(overrides: Partial<ConversationScrollTarget> = {}) {
  return {
    clientHeight: 400,
    scrollHeight: 2_000,
    scrollTo: vi.fn(),
    scrollTop: 1_600,
    ...overrides,
  } satisfies ConversationScrollTarget;
}

describe("conversation layout recovery", () => {
  it("recovers immediately and once more after WebKit completes the next layout frame", () => {
    const recover = vi.fn();
    const cancelFrame = vi.fn();
    let frame: (() => void) | undefined;

    const frameId = scheduleConversationLayoutRecovery({
      cancelFrame,
      frameId: 7,
      recover,
      requestFrame: (callback) => {
        frame = callback;
        return 8;
      },
    });

    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(frameId).toBe(8);

    frame?.();
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("restores the followed bottom after terminal content collapses", () => {
    const controller = createConversationAutoScrollController(vi.fn());
    const target = createScrollTarget({ scrollHeight: 800 });

    controller.handleLayoutRevision(target);

    expect(target.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 800 });
  });

  it("only clamps an invalid position when the user has left the bottom", () => {
    const controller = createConversationAutoScrollController(vi.fn());
    const target = createScrollTarget({ scrollHeight: 800, scrollTop: 1_600 });
    controller.pauseFollowing();

    controller.handleLayoutRevision(target);

    expect(target.scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 400 });

    const validPositionController = createConversationAutoScrollController(vi.fn());
    const validTarget = createScrollTarget({ scrollHeight: 800, scrollTop: 200 });
    validPositionController.pauseFollowing();
    validPositionController.handleLayoutRevision(validTarget);
    expect(validTarget.scrollTo).not.toHaveBeenCalled();
  });
});
