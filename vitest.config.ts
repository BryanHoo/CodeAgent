import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export const vitestAliases = {
  "@code-agent/engine-node": fileURLToPath(
    new URL("./packages/engine-node/src/index.ts", import.meta.url),
  ),
  "@code-agent/client": fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
  "@code-agent/host-transport": fileURLToPath(
    new URL("./packages/transport-http/src/index.ts", import.meta.url),
  ),
  "@code-agent/protocol": fileURLToPath(
    new URL("./packages/protocol/src/index.ts", import.meta.url),
  ),
  "@code-agent/server": fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url)),
  "@code-agent/transport-http": fileURLToPath(
    new URL("./packages/transport-http/src/index.ts", import.meta.url),
  ),
  "@code-agent/transport-tauri": fileURLToPath(
    new URL("./packages/transport-tauri/src/index.ts", import.meta.url),
  ),
};

export default defineConfig({
  resolve: {
    alias: vitestAliases,
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // 锁住当前覆盖率整数基线，性能验收由独立压力套件负责。
      thresholds: {
        branches: 59,
        functions: 59,
        lines: 64,
        statements: 63,
        "apps/web/src/features/workbench/components/workbench-composer-submission.ts": {
          branches: 40,
          functions: 60,
          lines: 60,
          statements: 60,
        },
        "packages/server/src/server-delivery.ts": {
          branches: 85,
          functions: 100,
          lines: 90,
          statements: 90,
        },
      },
    },
    exclude: [...configDefaults.exclude, "**/*.performance.test.{ts,tsx}"],
    include: ["{apps,packages}/**/*.test.{ts,tsx}", "tests/*.test.ts", "tools/**/*.test.ts"],
    passWithNoTests: true,
    restoreMocks: true,
  },
});
