import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["@tanstack/react-virtual"],
  },
  resolve: {
    alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }, { browser: "webkit" }],
      provider: playwright(),
      viewport: { height: 900, width: 1_440 },
    },
    include: ["src/**/*.browser.test.tsx"],
  },
});
