import { describe, expect, it } from "vitest";

import { loadGlobalSettingsDialog } from "../../settings/components/global-settings-lazy.js";
import {
  loadFileDiffDialog,
  loadFileReviewDialog,
  loadWorkbenchInspector,
} from "./workbench-shell-runtime.js";

describe("Workbench 非首屏模块加载边界", () => {
  it("通过独立动态入口加载 Inspector、Diff 和设置模块", async () => {
    const [inspector, fileDiff, fileReview, globalSettings] = await Promise.all([
      loadWorkbenchInspector(),
      loadFileDiffDialog(),
      loadFileReviewDialog(),
      loadGlobalSettingsDialog(),
    ]);

    expect(inspector.WorkbenchInspector).toBeTypeOf("function");
    expect(fileDiff.FileDiffDialog).toBeTypeOf("function");
    expect(fileReview.FileReviewDialog).toBeTypeOf("function");
    expect(globalSettings.GlobalSettingsDialog).toBeTypeOf("function");
  });
});
