import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const source = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "engine-node/index": source("packages/engine-node/src/index.ts"),
    "server/index": source("packages/server/src/index.ts"),
  },
  bundle: true,
  clean: true,
  dts: false,
  esbuildOptions(options) {
    // Fastify 插件含 CommonJS 动态 require，ESM bundle 通过 Node 标准桥接加载内置模块。
    options.banner = {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    };
    options.alias = {
      ...options.alias,
      "@code-agent/engine-node": source("packages/engine-node/src/index.ts"),
      "@code-agent/protocol": source("packages/protocol/src/index.ts"),
      "@code-agent/server": source("packages/server/src/index.ts"),
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
  async onSuccess() {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const output = fileURLToPath(new URL("./dist", import.meta.url));
    // 发布包资源在构建末尾一次性同步，运行时无需访问 Workspace 根目录。
    await Promise.all([
      cp(`${root}/dist/web`, `${output}/web`, { recursive: true }),
      ...["CHANGELOG.md", "LICENSE", "README.md", "README.zh-CN.md"].map(async (name) => {
        await mkdir(output, { recursive: true });
        await cp(`${root}/${name}`, `${output}/${name}`);
      }),
    ]);
  },
});
