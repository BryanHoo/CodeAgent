import { describe, expect, it, vi } from "vitest";

import { observeConversationViewportRecovery } from "./conversation-viewport-recovery.js";

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

describe("observeConversationViewportRecovery", () => {
  it("remeasures a foreground conversation and restores the followed end on the next frame", () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const measure = vi.fn();
    const scrollToEnd = vi.fn();
    let frame: (() => void) | undefined;

    observeConversationViewportRecovery({
      cancelFrame: vi.fn(),
      documentTarget: Object.assign(documentTarget, { visibilityState: "visible" }),
      isFollowing: () => true,
      measure,
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      scrollToEnd,
      windowTarget,
    });

    windowTarget.dispatch("focus");

    expect(measure).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).not.toHaveBeenCalled();
    frame?.();
    expect(measure).toHaveBeenCalledTimes(2);
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores hidden visibility changes and preserves a user position away from the end", () => {
    const documentTarget = Object.assign(new FakeEventTarget(), { visibilityState: "hidden" });
    const windowTarget = new FakeEventTarget();
    const measure = vi.fn();
    const scrollToEnd = vi.fn();
    let frame: (() => void) | undefined;

    observeConversationViewportRecovery({
      cancelFrame: vi.fn(),
      documentTarget,
      isFollowing: () => false,
      measure,
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      scrollToEnd,
      windowTarget,
    });

    documentTarget.dispatch("visibilitychange");
    expect(measure).not.toHaveBeenCalled();

    documentTarget.visibilityState = "visible";
    documentTarget.dispatch("visibilitychange");
    frame?.();

    expect(measure).toHaveBeenCalledTimes(2);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});
