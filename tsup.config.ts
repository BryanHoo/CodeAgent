import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "client/index": "packages/client/src/index.ts",
    "core/index": "packages/core/src/index.ts",
    "protocol/index": "packages/protocol/src/index.ts",
    "providers/codex/index": "packages/provider-codex/src/index.ts",
    "server/index": "packages/server/src/index.ts",
  },
  bundle: true,
  clean: false,
  dts: false,
  format: ["esm"],
  minify: false,
  outDir: "dist",
  platform: "node",
  sourcemap: true,
  splitting: true,
  target: "node24",
  treeshake: true,
});
