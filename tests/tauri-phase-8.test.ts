import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const readJson = (path: string): unknown => JSON.parse(read(path)) as unknown;

interface PackageManifest {
  readonly bin?: Record<string, string>;
  readonly files?: readonly string[];
  readonly name?: string;
  readonly optionalDependencies?: Record<string, string>;
  readonly private?: boolean;
  readonly version?: string;
}

const nativePackages = ["darwin-arm64", "darwin-x64", "linux-x64-gnu", "win32-x64-msvc"] as const;

describe("Tauri Phase 8 repository contract", () => {
  it("keeps the root package private and publishes only apps/node-cli", () => {
    const rootManifest = readJson("package.json") as PackageManifest;
    const cliManifest = readJson("apps/node-cli/package.json") as PackageManifest;

    expect(rootManifest.private).toBe(true);
    expect(rootManifest.bin).toBeUndefined();
    expect(rootManifest.files).toBeUndefined();
    expect(cliManifest).toMatchObject({
      bin: { "code-agent": "dist/cli.js" },
      name: "@bryanhu/code-agent",
      private: false,
      version: rootManifest.version,
    });
  });

  it("uses exact-version optional dependencies for every native target", () => {
    const rootManifest = readJson("package.json") as PackageManifest;
    const cliManifest = readJson("apps/node-cli/package.json") as PackageManifest;

    expect(cliManifest.optionalDependencies).toEqual(
      Object.fromEntries(
        nativePackages.map((target) => [`@bryanhu/code-agent-${target}`, rootManifest.version]),
      ),
    );
  });

  it.each(nativePackages)("defines a minimal %s native package", (target) => {
    const path = `packages/node-binding-${target}/package.json`;
    const manifest = readJson(path) as PackageManifest;

    expect(existsSync(resolve(root, path))).toBe(true);
    expect(manifest.name).toBe(`@bryanhu/code-agent-${target}`);
    expect(manifest.private).toBe(false);
    expect(manifest.files).toContain("code-agent-node-binding.node");
  });

  it("derives the Tauri version from the root product manifest", () => {
    const config = readJson("apps/desktop/src-tauri/tauri.conf.json") as { version?: string };

    expect(config.version).toBe("../../../package.json");
  });

  it("defines Phase 8 and release version gates", () => {
    const manifest = readJson("package.json") as { scripts?: Record<string, string> };

    expect(manifest.scripts?.["release:version:check"]).toContain("verify-release-versions.mjs");
    expect(manifest.scripts?.["tauri:phase8:check"]).toContain("tauri-phase-8.test.ts");
  });

  it("builds the four verified native and desktop release targets", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("target: darwin-arm64");
    expect(workflow).toContain("target: darwin-x64");
    expect(workflow).toContain("target: linux-x64-gnu");
    expect(workflow).toContain("target: win32-x64-msvc");
    expect(workflow).toContain("Publish native packages before the CLI");
    expect(workflow.indexOf("Publish native packages before the CLI")).toBeLessThan(
      workflow.indexOf("Publish main CLI package"),
    );
  });

  it("keeps internal workspace packages private", () => {
    const internalPackages = [
      "apps/desktop/package.json",
      "apps/web/package.json",
      "packages/client/package.json",
      "packages/engine-node/package.json",
      "packages/protocol/package.json",
      "packages/server/package.json",
      "packages/transport-http/package.json",
      "packages/transport-tauri/package.json",
    ];

    expect(internalPackages.map((path) => (readJson(path) as PackageManifest).private)).toEqual(
      internalPackages.map(() => true),
    );
  });
});
