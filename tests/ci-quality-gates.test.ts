import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CI 质量门禁", () => {
  it("仅在 Linux quality job 中执行覆盖率阈值检查", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const qualityJobStart = workflow.indexOf("\n  quality:\n");
    const qualityJobEnd = workflow.indexOf("\n  macos-smoke:\n", qualityJobStart);

    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(qualityJobStart).toBeGreaterThanOrEqual(0);
    expect(qualityJobEnd).toBeGreaterThan(qualityJobStart);

    const qualityJob = workflow.slice(qualityJobStart, qualityJobEnd);
    // 条件必须绑定矩阵 OS，避免 Windows 重复生成覆盖率报告。
    expect(qualityJob).toContain(`      - name: Enforce coverage thresholds
        if: matrix.os == 'ubuntu-latest'
        run: pnpm run test:coverage`);
    expect(workflow.match(/run: pnpm run test:coverage/g)).toHaveLength(1);
  });
});
