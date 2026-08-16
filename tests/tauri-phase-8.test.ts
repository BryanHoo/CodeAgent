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

const nativePackages = ["darwin-arm64", "linux-x64-gnu", "win32-x64-msvc"] as const;

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

  it("removes Intel macOS from product-owned native paths", () => {
    const productTargetFiles = [
      "apps/desktop/scripts/prepare-codex-binary.mjs",
      "packages/engine-node/src/codex-binary.ts",
      "packages/engine-node/src/native-binding.ts",
      "pnpm-workspace.yaml",
      "tools/build-native-addon.mjs",
      "tools/clean.mjs",
      "tools/verify-package.mjs",
      "tools/verify-release-versions.mjs",
    ];
    const targetConfiguration = productTargetFiles.map(read).join("\n");

    expect(existsSync(resolve(root, "packages/node-binding-darwin-x64"))).toBe(false);
    expect(targetConfiguration).not.toContain("darwin-x64");
    expect(targetConfiguration).not.toContain("x86_64-apple-darwin");
  });

  it("derives the Tauri version from the root product manifest", () => {
    const config = readJson("apps/desktop/src-tauri/tauri.conf.json") as { version?: string };

    expect(config.version).toBe("../../../package.json");
  });

  it("keeps release version verification in the full CI gate", () => {
    const manifest = readJson("package.json") as { scripts?: Record<string, string> };

    expect(manifest.scripts?.["release:version:check"]).toContain("verify-release-versions.mjs");
    expect(manifest.scripts?.["check:ci:quality"]).toContain("release:version:check");
    expect(manifest.scripts?.["tauri:phase8:check"]).toBeUndefined();
  });

  it("validates the packed native addon in a disposable child process", () => {
    const verifier = read("tools/verify-package.mjs");

    expect(verifier).toContain("function validateNativeAddon(path)");
    expect(verifier).toContain("validateNativeAddon(join(installedNative");
    expect(verifier).not.toContain("createRequire");
  });

  it("builds the three verified native and desktop release targets", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("os: macos-14, target: darwin-arm64, bundles: app,dmg");
    expect(workflow).toContain('os: ubuntu-22.04, target: linux-x64-gnu, bundles: "deb,appimage"');
    expect(workflow).toContain('os: windows-2022, target: win32-x64-msvc, bundles: nsis');
    expect(workflow).not.toContain("target: darwin-x64");
    expect(workflow).not.toContain("bundles: rpm");
    expect(workflow).toContain("args: --bundles ${{ matrix.bundles }}");
    expect(workflow).toContain("path: .artifacts/npm/");
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
