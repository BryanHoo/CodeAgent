import { defineConfig } from "vitest/config";

export default defineConfig({
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
