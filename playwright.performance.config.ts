import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  reporter: "list",
  retries: 0,
  testDir: "./tests/performance",
  testMatch: "timeline.performance.spec.ts",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  workers: 1,
});
