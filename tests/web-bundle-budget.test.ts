import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const checkerPath = join(process.cwd(), "tools/verify-web-bundle.mjs");
const temporaryRoots: string[] = [];

function createBundle(options: Readonly<{ asyncBytes?: number; initialBytes?: number }> = {}) {
  const root = mkdtempSync(join(tmpdir(), "code-agent-bundle-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, ".vite"), { recursive: true });
  mkdirSync(join(root, "assets"), { recursive: true });

  // 使用不可压缩内容验证 gzip 预算，避免测试数据大小与传输大小失真。
  writeFileSync(join(root, "assets/index.js"), randomBytes(options.initialBytes ?? 128));
  writeFileSync(join(root, "assets/shared.js"), "export const shared = true;");
  writeFileSync(join(root, "assets/lazy.js"), randomBytes(options.asyncBytes ?? 128));
  writeFileSync(join(root, "assets/lazy-shared.js"), "export const lazyShared = true;");
  writeFileSync(
    join(root, ".vite/manifest.json"),
    JSON.stringify({
      "_lazy-shared.js": { file: "assets/lazy-shared.js" },
      "_shared.js": { file: "assets/shared.js" },
      "index.html": {
        dynamicImports: ["src/lazy.ts"],
        file: "assets/index.js",
        imports: ["_shared.js"],
        isEntry: true,
      },
      "src/lazy.ts": {
        file: "assets/lazy.js",
        imports: ["_lazy-shared.js"],
        isDynamicEntry: true,
      },
    }),
  );
  return root;
}

function runChecker(root: string) {
  return spawnSync(process.execPath, [checkerPath, root], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Web Bundle 预算门禁", () => {
  it("接受低于首屏和异步预算的生产产物", () => {
    const result = runChecker(createBundle());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Web Bundle budget passed");
  });

  it("拒绝超过首屏 gzip 预算的产物", () => {
    const result = runChecker(createBundle({ initialBytes: 260 * 1024 }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("initial gzip budget exceeded");
  });

  it("拒绝超过单个异步加载组 gzip 预算的产物", () => {
    const result = runChecker(createBundle({ asyncBytes: 220 * 1024 }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("async gzip budget exceeded");
  });

  it("拒绝引用缺失 Chunk 的无效 manifest", () => {
    const root = createBundle();
    writeFileSync(
      join(root, ".vite/manifest.json"),
      JSON.stringify({
        "index.html": {
          file: "assets/index.js",
          imports: ["_missing.js"],
          isEntry: true,
        },
      }),
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown manifest chunk");
  });
});
