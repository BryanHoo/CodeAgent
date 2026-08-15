import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const readJson = (path: string): unknown => JSON.parse(read(path)) as unknown;

interface UpdaterSigningModule {
  resolveUpdaterSigningEnvironment: (options: {
    environment: NodeJS.ProcessEnv;
    fileExists: (path: string) => boolean;
    homeDirectory: string;
  }) => NodeJS.ProcessEnv;
}

describe("Tauri Phase 9 updater contract", () => {
  it("enables the hardened runtime while explicitly disabling App Sandbox", () => {
    const config = readJson("apps/desktop/src-tauri/tauri.conf.json") as {
      bundle?: {
        macOS?: {
          entitlements?: string;
          hardenedRuntime?: boolean;
          minimumSystemVersion?: string;
        };
      };
    };
    const entitlements = read("apps/desktop/src-tauri/Entitlements.plist");

    expect(config.bundle?.macOS).toEqual({
      entitlements: "./Entitlements.plist",
      hardenedRuntime: true,
      minimumSystemVersion: "14.0",
    });
    expect(entitlements).toMatch(/<key>com\.apple\.security\.app-sandbox<\/key>\s*<false\/>/u);
    expect(entitlements).not.toContain("<true/>");
  });

  it("uses a signed HTTPS GitHub Release updater", () => {
    const config = readJson("apps/desktop/src-tauri/tauri.conf.json") as {
      bundle?: { createUpdaterArtifacts?: boolean };
      plugins?: { updater?: { endpoints?: string[]; pubkey?: string } };
    };
    const updater = config.plugins?.updater;

    expect(config.bundle?.createUpdaterArtifacts).toBe(true);
    expect(updater?.endpoints).toEqual([
      "https://github.com/BryanHoo/CodeAgent/releases/latest/download/latest.json",
    ]);
    expect(updater?.pubkey).toMatch(/^[A-Za-z0-9+/]+=*$/u);
    expect(Buffer.from(updater?.pubkey ?? "", "base64").toString("utf8")).toContain(
      "untrusted comment: minisign public key:",
    );
  });

  it("registers the updater plugin, command, and main-window capability", () => {
    const rootCargo = read("Cargo.toml");
    const desktopCargo = read("apps/desktop/src-tauri/Cargo.toml");
    const desktopLibrary = read("apps/desktop/src-tauri/src/lib.rs");
    const capability = readJson("apps/desktop/src-tauri/capabilities/main.json") as {
      permissions?: string[];
    };

    expect(rootCargo).toContain("tauri-plugin-updater");
    expect(desktopCargo).toContain("tauri-plugin-updater.workspace = true");
    expect(desktopLibrary).toContain("tauri_plugin_updater::Builder::new().build()");
    expect(desktopLibrary).toContain("commands::app::app_update_install");
    expect(capability.permissions).toContain("updater:default");
  });

  it("publishes signed updater metadata and artifacts to GitHub Releases", () => {
    const workflow = read(".github/workflows/release.yml");
    const releaseGuide = read("docs/releasing.md");

    expect(workflow).toContain("tauri-apps/tauri-action@944946e3e4cac6603d1fe8f514171e9ecd3c78aa");
    expect(workflow).toContain(
      "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
    );
    expect(workflow).toContain("uploadUpdaterJson: true");
    expect(workflow).toContain("uploadUpdaterSignatures: true");
    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).toContain('gh release upload "${RELEASE_TAG}"');
    expect(workflow).not.toContain('gh release create "${RELEASE_TAG}"');
    expect(releaseGuide).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(releaseGuide).toContain(
      "https://github.com/BryanHoo/CodeAgent/releases/latest/download/latest.json",
    );
  });

  it("signs, notarizes, and verifies Apple Silicon release artifacts", () => {
    const workflow = read(".github/workflows/release.yml");
    const requiredSecrets = [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_API_ISSUER",
      "APPLE_API_KEY",
      "APPLE_API_PRIVATE_KEY",
    ];

    for (const secret of requiredSecrets) {
      expect(workflow).toContain(`${secret}: \${{ secrets.${secret} }}`);
    }
    expect(workflow).toContain('key_path="${RUNNER_TEMP}/app-store-connect-private-key.p8"');
    expect(workflow).toContain('chmod 600 "${key_path}"');
    expect(workflow).toContain("APPLE_API_KEY_PATH: ${{ env.APPLE_API_KEY_PATH }}");
    expect(workflow).toContain("codesign --verify --deep --strict --verbose=2");
    expect(workflow).toContain('codesign -d --entitlements "${signed_entitlements}" --xml');
    expect(workflow).toContain("com.apple.security.app-sandbox");
    expect(workflow).toContain('grep -qx "true"');
    expect(workflow).toContain("xcrun stapler validate");
    expect(workflow).toContain("spctl --assess --type execute --verbose=4");
    expect(workflow).toContain("spctl --assess --type open --context context:primary-signature");
    expect(workflow.indexOf("Verify macOS signatures and notarization")).toBeLessThan(
      workflow.indexOf("Pack npm artifacts"),
    );
  });

  it("publishes Windows Desktop as Preview / Unsigned without a signing gate", () => {
    const config = readJson("apps/desktop/src-tauri/tauri.conf.json") as {
      bundle?: { windows?: { signCommand?: string } };
    };
    const workflow = read(".github/workflows/release.yml");

    expect(config.bundle?.windows?.signCommand).toBeUndefined();
    expect(existsSync(resolve(root, "apps/desktop/scripts/sign-windows.ps1"))).toBe(false);
    expect(existsSync(resolve(root, "tools/release/verify-windows-signatures.ps1"))).toBe(false);
    expect(workflow).toContain("Build and upload Windows Desktop (Preview / Unsigned)");
    expect(workflow).toContain("Windows Desktop: Preview / Unsigned");
    expect(workflow).not.toMatch(/AZURE_|Artifact Signing|Authenticode/u);
    expect(workflow).toContain(
      "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
    );
  });

  it("smokes CLI and Desktop artifacts on every minimum supported system", () => {
    const workflow = read(".github/workflows/release.yml");
    const cliSmoke = read("tools/release/smoke-cli.mjs");
    const macosSmoke = read("tools/release/smoke-desktop-macos.sh");
    const linuxSmoke = read("tools/release/smoke-desktop-linux.sh");
    const windowsSmoke = read("tools/release/smoke-desktop-windows.ps1");

    expect(workflow).toContain("smoke-hosted:");
    expect(workflow).toContain("os: macos-14");
    expect(workflow).toContain("os: ubuntu-22.04");
    expect(workflow).toContain("smoke-windows-10:");
    expect(workflow).toContain("runs-on: [self-hosted, Windows, X64, windows-10]");
    expect(workflow).toContain("needs: build");
    expect(workflow).toContain("node tools/release/smoke-cli.mjs");
    expect(workflow).toContain("script: smoke-desktop-macos.sh");
    expect(workflow).toContain("script: smoke-desktop-linux.sh");
    expect(workflow).toContain('bash "tools/release/${{ matrix.script }}"');
    expect(workflow).toContain("tools/release/smoke-desktop-windows.ps1");
    expect(cliSmoke).toContain('"doctor"');
    expect(cliSmoke).toContain('"--help"');
    expect(macosSmoke).toContain("hdiutil attach");
    expect(macosSmoke).toContain("spctl --assess");
    expect(linuxSmoke).toContain("xvfb-run");
    expect(linuxSmoke).toContain("apt-get install");
    expect(windowsSmoke).not.toContain("verify-windows-signatures.ps1");
    expect(windowsSmoke).toContain("/S");
  });

  it("publishes npm and promotes the draft only after every smoke passes", () => {
    const releaseWorkflow = read(".github/workflows/release.yml");
    const ciWorkflow = read(".github/workflows/ci.yml");
    const approvalJob = releaseWorkflow.slice(
      releaseWorkflow.indexOf("  release-approval:"),
      releaseWorkflow.indexOf("  publish:"),
    );
    const publishJob = releaseWorkflow.slice(releaseWorkflow.indexOf("  publish:"));

    expect(ciWorkflow).toContain("runs-on: macos-14");
    expect(approvalJob).toContain("needs: [smoke-hosted, smoke-windows-10]");
    expect(approvalJob).toContain("environment: release");
    expect(publishJob).toContain("needs: [build, release-approval]");
    expect(publishJob).toContain('gh release edit "${RELEASE_TAG}" --draft=false');
    expect(publishJob.indexOf("Publish native packages before the CLI")).toBeLessThan(
      publishJob.indexOf("Publish main CLI package"),
    );
    expect(publishJob.indexOf("Publish main CLI package")).toBeLessThan(
      publishJob.indexOf('gh release edit "${RELEASE_TAG}" --draft=false'),
    );
  });

  it("documents the macOS 14 Apple Silicon signing and notarization runbook", () => {
    const releaseGuide = read("docs/releasing.md");
    const migrationPlan = read("docs/tauri-migration-plan.md");
    const engineeringGuide = read(".superwork/spec/guides/index.md");

    expect(releaseGuide).toContain("macOS 14+");
    expect(releaseGuide).toContain("Developer ID Application");
    expect(releaseGuide).toContain("APPLE_API_PRIVATE_KEY");
    expect(releaseGuide).toContain("codesign --verify --deep --strict");
    expect(releaseGuide).toContain("xcrun stapler validate");
    expect(releaseGuide).toContain("spctl --assess");
    expect(releaseGuide).not.toContain("macOS Intel");
    expect(migrationPlan).toContain("Phase 9：进行中");
    expect(migrationPlan).not.toContain("macOS x64");
    expect(migrationPlan).not.toContain("x86_64-apple-darwin");
    expect(engineeringGuide).toContain("macOS 14+");
  });

  it("documents the supported Desktop and CLI release matrix", () => {
    const readme = read("README.md");
    const chineseReadme = read("README.zh-CN.md");
    const releaseGuide = read("docs/releasing.md");
    const migrationPlan = read("docs/tauri-migration-plan.md");
    const engineeringGuide = read(".superwork/spec/guides/index.md");
    const supportMarkers = ["macOS 14+", "Windows 10+", "Ubuntu 22.04+"];

    for (const marker of supportMarkers) {
      expect(readme).toContain(marker);
      expect(chineseReadme).toContain(marker);
      expect(releaseGuide).toContain(marker);
      expect(engineeringGuide).toContain(marker);
    }
    expect(readme).toContain("https://github.com/BryanHoo/CodeAgent/releases");
    expect(chineseReadme).toContain("https://github.com/BryanHoo/CodeAgent/releases");
    expect(readme).toContain("Preview / Unsigned");
    expect(chineseReadme).toContain("Preview / Unsigned");
    expect(releaseGuide).toContain("Preview / Unsigned");
    expect(releaseGuide).not.toMatch(/AZURE_|Artifact Signing|Authenticode/u);
    expect(releaseGuide).toContain("self-hosted, Windows, X64, windows-10");
    expect(releaseGuide).toContain('gh release edit "${RELEASE_TAG}" --draft=false');
    expect(migrationPlan).toContain("Windows Desktop 暂以 Preview / Unsigned 发布");
    expect(migrationPlan).not.toContain("Windows 签名和 Linux clean VM 验证待完成");
  });

  it("resolves updater signing credentials for CI and local Desktop builds", async () => {
    const signingModuleUrl = pathToFileURL(
      resolve(root, "apps/desktop/scripts/run-tauri-build.mjs"),
    ).href;
    const { resolveUpdaterSigningEnvironment } = (await import(
      signingModuleUrl
    )) as UpdaterSigningModule;

    const ciEnvironment = resolveUpdaterSigningEnvironment({
      environment: {
        TAURI_SIGNING_PRIVATE_KEY: "ci-private-key",
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "ci-password",
      },
      fileExists: () => true,
      homeDirectory: "/unused",
    });
    expect(ciEnvironment["TAURI_SIGNING_PRIVATE_KEY"]).toBe("ci-private-key");
    expect(ciEnvironment["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]).toBe("ci-password");

    const homeDirectory = resolve(root, ".test-home");
    const localKeyPath = join(homeDirectory, ".tauri", "code-agent-updater.key");
    const localEnvironment = resolveUpdaterSigningEnvironment({
      environment: {},
      fileExists: (path) => path === localKeyPath,
      homeDirectory,
    });
    expect(localEnvironment["TAURI_SIGNING_PRIVATE_KEY"]).toBe(localKeyPath);
    expect(localEnvironment["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]).toBe("");

    expect(() =>
      resolveUpdaterSigningEnvironment({
        environment: {},
        fileExists: () => false,
        homeDirectory,
      }),
    ).toThrow(/TAURI_SIGNING_PRIVATE_KEY/u);
  });
});
