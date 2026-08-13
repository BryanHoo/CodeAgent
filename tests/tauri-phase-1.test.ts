import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function readRepositoryFile(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

function readRepositoryJson(path: string): unknown {
  return JSON.parse(readRepositoryFile(path)) as unknown;
}

describe("Tauri Phase 1 repository contract", () => {
  it("defines the virtual Cargo workspace and planned crate boundaries", () => {
    const cargoManifest = readRepositoryFile("Cargo.toml");
    const crateNames = [
      "protocol",
      "core",
      "provider-codex",
      "platform",
      "runtime",
      "node-binding",
      "protocol-gen",
    ];

    expect(cargoManifest).toContain('resolver = "3"');
    expect(cargoManifest).toContain("[workspace.package]");
    expect(cargoManifest).toContain("[workspace.dependencies]");
    expect(cargoManifest).toContain("[workspace.lints.rust]");
    expect(cargoManifest).toContain("[workspace.lints.clippy]");
    for (const crateName of crateNames) {
      expect(cargoManifest).toContain(`"crates/${crateName}"`);
      expect(existsSync(join(repositoryRoot, `crates/${crateName}/Cargo.toml`))).toBe(true);
    }
  });

  it("keeps the desktop entry point thin and grants only minimal capability", () => {
    const mainSource = readRepositoryFile("apps/desktop/src-tauri/src/main.rs");
    const librarySource = readRepositoryFile("apps/desktop/src-tauri/src/lib.rs");
    const capability = readRepositoryJson("apps/desktop/src-tauri/capabilities/main.json") as {
      $schema: string;
      description: string;
      identifier: string;
      permissions: string[];
      windows: string[];
    };

    expect(mainSource).toContain("code_agent_desktop_lib::run();");
    expect(mainSource).not.toContain("tauri::Builder");
    expect(librarySource).toContain("tauri::Builder::default()");
    expect(librarySource.match(/generate_handler!/gu)).toHaveLength(1);
    expect(librarySource).not.toContain("commands::execute");
    expect(capability).toEqual({
      $schema: "../gen/schemas/desktop-schema.json",
      description: "允许主窗口使用 Tauri 核心窗口能力。",
      identifier: "main-capability",
      permissions: ["core:default"],
      windows: ["main"],
    });
  });

  it("provides isolated desktop scripts without changing the npm build path", () => {
    const desktopPackage = readRepositoryJson("apps/desktop/package.json") as {
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
      name: string;
      scripts: Record<string, string>;
    };
    const rootPackage = readRepositoryJson("package.json") as {
      private: boolean;
      scripts: Record<string, string>;
    };
    const cliPackage = readRepositoryJson("apps/node-cli/package.json") as {
      files: string[];
    };
    const tauriConfig = readRepositoryJson("apps/desktop/src-tauri/tauri.conf.json") as {
      build: { devUrl: string; frontendDist: string };
    };

    expect(desktopPackage).toMatchObject({
      devDependencies: { "@tauri-apps/cli": "catalog:" },
      name: "@code-agent/desktop",
      scripts: {
        build: "node ./scripts/prepare-codex-binary.mjs && tauri build",
        dev: "node ./scripts/prepare-codex-binary.mjs && tauri dev",
        tauri: "tauri",
      },
    });
    expect(desktopPackage.dependencies).toEqual({ "@openai/codex": "catalog:" });
    expect(tauriConfig.build).toMatchObject({
      devUrl: "http://127.0.0.1:5173",
      frontendDist: "../../../dist/desktop",
    });
    expect(rootPackage.scripts).toMatchObject({
      "build:desktop": "pnpm --filter @code-agent/desktop build",
      "build:desktop-ui": "pnpm --filter @code-agent/web build:desktop",
      "build:web": "pnpm --filter @code-agent/web build:web",
    });
    expect(rootPackage.scripts["check:rust"]).toContain("cargo check --workspace --locked");
    expect(rootPackage.scripts["build"]).not.toContain("build:desktop");
    expect(rootPackage.private).toBe(true);
    expect(cliPackage.files).toEqual(["dist"]);
  });
});
