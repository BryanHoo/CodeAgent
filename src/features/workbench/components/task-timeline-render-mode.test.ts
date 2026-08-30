import { describe, expect, it } from "vitest";

import { getTaskTurnRenderMode } from "./task-timeline-render-mode.js";

describe("getTaskTurnRenderMode", () => {
  it("keeps the latest three turns hot", () => {
    expect(getTaskTurnRenderMode({ status: "completed" }, 7, 10)).toBe("hot");
    expect(getTaskTurnRenderMode({ status: "failed" }, 8, 10)).toBe("hot");
    expect(getTaskTurnRenderMode({ status: "interrupted" }, 9, 10)).toBe("hot");
  });

  it("marks older terminal turns cold", () => {
    expect(getTaskTurnRenderMode({ status: "completed" }, 6, 10)).toBe("cold");
    expect(getTaskTurnRenderMode({ status: "failed" }, 0, 10)).toBe("cold");
  });

  it("keeps running and unresolved turns hot regardless of age", () => {
    expect(getTaskTurnRenderMode({ status: "running" }, 0, 10)).toBe("hot");
    expect(getTaskTurnRenderMode(undefined, 0, 10)).toBe("hot");
  });
});
