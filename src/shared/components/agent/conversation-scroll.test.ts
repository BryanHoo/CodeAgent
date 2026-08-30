import { describe, expect, it, vi } from "vitest";

import {
  createConversationAutoScrollController,
  observeConversationLayoutRecovery,
  scheduleConversationLayoutRecovery,
  type ConversationScrollTarget,
} from "./conversation-scroll.js";

class FakeRecoveryEventTarget {
  public visibilityState: DocumentVisibilityState = "visible";
  readonly #listeners = new Map<string, Set<() => void>>();

  public addEventListener(type: string, listener: () => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public dispatch(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener();
  }

  public removeEventListener(type: string, listener: () => void): void {
    this.#listeners.get(type)?.delete(listener);
  }
}

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

  it("重新聚焦后同步并在下一帧再次恢复布局", () => {
    const documentTarget = new FakeRecoveryEventTarget();
    const windowTarget = new FakeRecoveryEventTarget();
    const recover = vi.fn();
    let frame: (() => void) | undefined;
    const dispose = observeConversationLayoutRecovery({
      cancelFrame: vi.fn(),
      documentTarget,
      recover,
      requestFrame(callback) {
        frame = callback;
        return 1;
      },
      windowTarget,
    });

    windowTarget.dispatch("focus");

    expect(recover).toHaveBeenCalledTimes(1);
    frame?.();
    expect(recover).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("只在对话重新可见时恢复并在卸载后停止监听", () => {
    const documentTarget = new FakeRecoveryEventTarget();
    const windowTarget = new FakeRecoveryEventTarget();
    const recover = vi.fn();
    const dispose = observeConversationLayoutRecovery({
      cancelFrame: vi.fn(),
      documentTarget,
      recover,
      requestFrame: vi.fn(() => 1),
      windowTarget,
    });

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatch("visibilitychange");
    expect(recover).not.toHaveBeenCalled();

    documentTarget.visibilityState = "visible";
    documentTarget.dispatch("visibilitychange");
    expect(recover).toHaveBeenCalledTimes(1);

    dispose();
    windowTarget.dispatch("focus");
    expect(recover).toHaveBeenCalledTimes(1);
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
