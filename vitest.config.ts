import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@code-agent/provider-codex": fileURLToPath(
        new URL("./packages/provider-codex/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
    include: ["{apps,packages,src}/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
    restoreMocks: true,
  },
});
