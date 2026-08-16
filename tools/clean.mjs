import { rm } from "node:fs/promises";

// 只清理可再生成的构建产物及旧版增量缓存，避免脚本触及源码和用户数据。
await Promise.all(
  [
    "dist",
    "apps/node-cli/dist",
    "coverage",
    "playwright-report",
    "test-results",
    ".cache",
    "tsconfig.node.tsbuildinfo",
    "apps/web/tsconfig.app.tsbuildinfo",
    "apps/web/tsconfig.node.tsbuildinfo",
    "apps/node-cli/tsconfig.tsbuildinfo",
    "packages/client/tsconfig.tsbuildinfo",
    "packages/engine-node/tsconfig.tsbuildinfo",
    "packages/protocol/tsconfig.tsbuildinfo",
    "packages/server/tsconfig.tsbuildinfo",
    "packages/node-binding-darwin-arm64/code-agent-node-binding.node",
    "packages/node-binding-linux-x64-gnu/code-agent-node-binding.node",
    "packages/node-binding-win32-x64-msvc/code-agent-node-binding.node",
    "packages/engine-node/native/code-agent-node-binding.node",
    "tests/tsconfig.tsbuildinfo",
  ].map((path) => rm(path, { force: true, recursive: true })),
);
