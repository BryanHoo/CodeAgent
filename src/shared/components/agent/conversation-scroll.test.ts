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
  it("结构收缩后跨帧轻微滚动并恢复原位置以触发重绘", () => {
    const recover = vi.fn();
    const cancelFrame = vi.fn();
    const frames: Array<() => void> = [];
    const scrollTarget = createScrollTarget();
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      scrollTarget.scrollTop = options.top ?? scrollTarget.scrollTop;
    });
    scrollTarget.scrollTo = scrollTo;

    const dispose = scheduleConversationLayoutRecovery({
      cancelFrame,
      recover,
      requestFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      scrollTarget,
    });

    expect(recover).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();

    frames.shift()?.();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 1_599 });

    frames.shift()?.();
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 1_600 });
    dispose();
  });

  it("重新聚焦后跨帧轻微滚动并恢复原位置以触发重绘", () => {
    const documentTarget = new FakeRecoveryEventTarget();
    const windowTarget = new FakeRecoveryEventTarget();
    const recover = vi.fn();
    const frames: Array<() => void> = [];
    const scrollTarget = createScrollTarget();
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      scrollTarget.scrollTop = options.top ?? scrollTarget.scrollTop;
    });
    scrollTarget.scrollTo = scrollTo;
    const dispose = observeConversationLayoutRecovery({
      cancelFrame: vi.fn(),
      documentTarget,
      recover,
      scrollTarget,
      requestFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      windowTarget,
    });

    windowTarget.dispatch("focus");

    expect(recover).toHaveBeenCalledTimes(1);
    frames.shift()?.();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 1_599 });

    frames.shift()?.();
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 1_600 });
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
      scrollTarget: createScrollTarget(),
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

  it("任务切换尚未稳定时忽略延迟滚动并继续跟随内容", () => {
    const controller = createConversationAutoScrollController(vi.fn());
    const target = createScrollTarget();

    controller.handleConversationChange(target);
    controller.handleConversationRenderComplete(target);
    vi.mocked(target.scrollTo).mockClear();

    // 历史 Turn 延迟展开时，旧高度产生的 scroll 不能被误判为用户主动离底。
    target.scrollTop = 1_200;
    controller.handleScroll(target);
    expect(target.scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 2_000 });

    vi.mocked(target.scrollTo).mockClear();
    target.scrollHeight = 2_400;
    controller.handleContentResize(target);
    expect(target.scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: 2_400 });
  });

  it("任务切换到达底部后允许用户停止自动跟随", () => {
    const controller = createConversationAutoScrollController(vi.fn());
    const target = createScrollTarget();

    controller.handleConversationChange(target);
    controller.handleConversationRenderComplete(target);
    target.scrollTop = 1_600;
    controller.handleScroll(target);

    vi.mocked(target.scrollTo).mockClear();
    target.scrollTop = 1_000;
    controller.handleScroll(target);
    target.scrollHeight = 2_400;
    controller.handleContentResize(target);
    expect(target.scrollTo).not.toHaveBeenCalled();
  });
});
