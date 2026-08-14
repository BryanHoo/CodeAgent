import { readFileSync } from "node:fs";
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
