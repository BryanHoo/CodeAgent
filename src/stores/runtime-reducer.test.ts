import { describe, expect, it } from "vitest";

import { INITIAL_RUNTIME_STATE, reduceRuntimeEvent } from "@/stores/runtime-reducer";

describe("reduceRuntimeEvent", () => {
  it("applies a newer runtime event", () => {
    const state = reduceRuntimeEvent(INITIAL_RUNTIME_STATE, {
      type: "runtimeStatus",
      data: { seq: 1, status: "ready", provider: "codex" },
    });

    expect(state.snapshot).toEqual({
      schemaVersion: 1,
      status: "ready",
      provider: "codex",
      lastSeq: 1,
    });
  });

  it("keeps the existing reference for stale events", () => {
    const current = {
      ...INITIAL_RUNTIME_STATE,
      snapshot: { ...INITIAL_RUNTIME_STATE.snapshot, lastSeq: 4 },
    };
    const state = reduceRuntimeEvent(current, {
      type: "runtimeStatus",
      data: { seq: 3, status: "failed", provider: "codex" },
    });

    expect(state).toBe(current);
  });
});
