import { describe, expect, it } from "vitest";

import { getInspectorMaximumWidth, inspectorWidthLimits } from "./workbench-panel-layout.js";

describe("workbench panel layout", () => {
  it("uses the original inspector width at every desktop viewport", () => {
    expect(inspectorWidthLimits.default).toBe(288);
  });

  it("limits the inspector to half of the space remaining after the sidebar", () => {
    expect(getInspectorMaximumWidth(1440, 288)).toBe(576);
    expect(getInspectorMaximumWidth(1440, 400)).toBe(520);
  });
});
