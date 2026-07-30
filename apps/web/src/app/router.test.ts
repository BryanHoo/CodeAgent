import { describe, expect, it } from "vitest";

import { projectRoute } from "./routes/project-route.js";
import { taskRoute } from "./routes/task-route.js";

describe("workbench route code splitting", () => {
  it.each([
    ["project", projectRoute],
    ["task", taskRoute],
  ])("lazy-loads the %s route component", (_, route) => {
    // 路由匹配配置保留在首屏，工作台组件仅在命中路由后加载。
    expect(route.options.component).toBeUndefined();
    expect(route.lazyFn).toBeTypeOf("function");
  });
});
