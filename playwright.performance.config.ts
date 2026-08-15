import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  reporter: "list",
  retries: 0,
  testDir: "./tests/performance",
  testMatch: ["markdown-streaming.performance.spec.ts", "timeline.performance.spec.ts"],
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    locale: "zh-CN",
    // 性能采样必须关闭 trace，避免追踪器把自身 CPU 与内存计入被测页面。
    trace: "off",
  },
  workers: 1,
});
