import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CI 质量门禁", () => {
  it("分离本地基线与 CI 全量检查且不重复执行阶段测试", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const vitestConfig = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");

    expect(packageJson.scripts["check"]).toBe(
      "pnpm run format:check && pnpm run lint && pnpm run lint:architecture && pnpm run typecheck && pnpm run test",
    );
    expect(packageJson.scripts["check:ci"]).toBe(
      "pnpm run check:ci:host && pnpm run test:performance:browser",
    );
    expect(packageJson.scripts["check:ci:host"]).toBe(
      "pnpm run check:ci:quality && pnpm run test:performance:host",
    );
    expect(packageJson.scripts["check:ci:quality"]).toContain("pnpm run check");
    expect(packageJson.scripts["check:ci:quality"]).toContain("pnpm run audit:prod");
    expect(packageJson.scripts["check:ci:quality"]).toContain("pnpm run codex:schema:check");
    expect(packageJson.scripts["check:ci:quality"]).toContain("pnpm run protocol:rust:check");
    expect(packageJson.scripts["check:ci:host"]).toContain("pnpm run test:performance:host");
    expect(packageJson.scripts["test:performance"]).toContain("pnpm run test:performance:host");
    expect(packageJson.scripts["check:ci:quality"]).toContain("pnpm run build");
    expect(packageJson.scripts["check:ci:quality"]).toContain("pnpm run bundle:check");
    expect(packageJson.scripts["check:ci:quality"]).toContain("pnpm run package:check");
    expect(packageJson.scripts["protocol:rust:check"]).not.toContain("vitest");
    expect(packageJson.scripts["prepublishOnly"]).toBe("pnpm run check:ci");

    // 阶段契约由统一测试入口收集一次，不再维护累积执行的脚本别名。
    for (const phase of [4, 5, 6, 7, 8]) {
      expect(packageJson.scripts[`tauri:phase${String(phase)}:check`]).toBeUndefined();
    }
    expect(vitestConfig).toContain('"tests/*.test.ts"');
  });

  it("仅在 Linux quality job 中执行覆盖率阈值检查", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const qualityJobStart = workflow.indexOf("\n  quality:\n");
    const qualityJobEnd = workflow.indexOf("\n  browser-performance:\n", qualityJobStart);

    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(qualityJobStart).toBeGreaterThanOrEqual(0);
    expect(qualityJobEnd).toBeGreaterThan(qualityJobStart);

    const qualityJob = workflow.slice(qualityJobStart, qualityJobEnd);
    expect(qualityJob).toContain(`      - name: Run quality gates
        run: pnpm check:ci:quality`);
    expect(qualityJob).toContain(`      - name: Run host performance gates
        if: matrix.os == 'ubuntu-latest'
        run: pnpm run test:performance:host`);
    expect(qualityJob).toContain("libwebkit2gtk-4.1-dev");
    expect(qualityJob).not.toContain("run: pnpm check\n");
    // 条件必须绑定矩阵 OS，避免 Windows 重复生成覆盖率报告。
    expect(qualityJob).toContain(`      - name: Enforce coverage thresholds
        if: matrix.os == 'ubuntu-latest'
        run: pnpm run test:coverage`);
    expect(workflow.match(/run: pnpm run test:coverage/g)).toHaveLength(1);
    expect(workflow).toContain("name: Browser Performance");
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain("run: pnpm run test:performance:browser");
  });
});
