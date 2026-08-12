import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "client/index": "packages/client/src/index.ts",
    "engine-node/index": "packages/engine-node/src/index.ts",
    "protocol/index": "packages/protocol/src/index.ts",
    "server/index": "packages/server/src/index.ts",
  },
  bundle: true,
  clean: false,
  dts: false,
  esbuildOptions(options) {
    // Fastify 插件仍包含 CommonJS 动态 require，ESM bundle 通过 Node 标准桥接加载内置模块。
    options.banner = {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    };
    options.alias = {
      ...options.alias,
      "@code-agent/engine-node": "./packages/engine-node/src/index.ts",
      "@code-agent/protocol": "./packages/protocol/src/index.ts",
      "@code-agent/server": "./packages/server/src/index.ts",
    };
  },
  format: ["esm"],
  minify: false,
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: true,
  target: "node24",
  treeshake: true,
});
