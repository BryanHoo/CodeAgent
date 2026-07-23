import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node tests/fixtures/fake-realtime-server.mjs",
    url: "http://127.0.0.1:4173",
    // Fake Server 持有事件序号和场景状态，每次测试运行必须使用全新进程。
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
