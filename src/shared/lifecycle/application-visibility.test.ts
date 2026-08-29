import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DelayedBackgroundSuspension,
  runDetailViewInterval,
  type DetailViewUpdateGate,
} from "./application-visibility.js";

class FakeVisibilityTarget {
  public visibilityState: DocumentVisibilityState = "visible";
  readonly #listeners = new Set<() => void>();

  public addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.#listeners.add(listener);
  }

  public removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.#listeners.delete(listener);
  }

  public setVisibility(visibilityState: DocumentVisibilityState): void {
    this.visibilityState = visibilityState;
    for (const listener of this.#listeners) listener();
  }
}

describe("DelayedBackgroundSuspension", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("只在持续隐藏达到阈值后暂停，并忽略短时间前后台切换", () => {
    vi.useFakeTimers();
    const target = new FakeVisibilityTarget();
    const suspension = new DelayedBackgroundSuspension(target, 5_000);
    const listener = vi.fn();
    suspension.subscribe(listener);

    target.setVisibility("hidden");
    vi.advanceTimersByTime(4_999);
    expect(suspension.isSuspended()).toBe(false);

    target.setVisibility("visible");
    vi.advanceTimersByTime(5_000);
    expect(suspension.isSuspended()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    target.setVisibility("hidden");
    vi.advanceTimersByTime(5_000);
    expect(suspension.isSuspended()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    target.setVisibility("visible");
    expect(suspension.isSuspended()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    suspension.dispose();
  });

  it("暂停时停止详细视图计时器，并在恢复时立即校准", () => {
    vi.useFakeTimers();
    const listeners = new Set<() => void>();
    let suspended = false;
    const gate: DetailViewUpdateGate = {
      isSuspended: () => suspended,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const tick = vi.fn();
    const dispose = runDetailViewInterval(gate, tick, 1_000);

    vi.advanceTimersByTime(2_000);
    expect(tick).toHaveBeenCalledTimes(2);

    suspended = true;
    for (const listener of listeners) listener();
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(2);

    suspended = false;
    for (const listener of listeners) listener();
    expect(tick).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1_000);
    expect(tick).toHaveBeenCalledTimes(4);

    dispose();
  });
});
