import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@code-agent/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@code-agent/client": fileURLToPath(
        new URL("./packages/client/src/index.ts", import.meta.url),
      ),
      "@code-agent/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url),
      ),
      "@code-agent/provider-codex": fileURLToPath(
        new URL("./packages/provider-codex/src/index.ts", import.meta.url),
      ),
      "@code-agent/server": fileURLToPath(
        new URL("./packages/server/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
    include: ["{apps,packages,src}/**/*.test.{ts,tsx}", "tests/*.test.ts"],
    passWithNoTests: true,
    restoreMocks: true,
  },
});
