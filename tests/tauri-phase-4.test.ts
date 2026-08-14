import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

describe("Tauri Phase 4 repository contract", () => {
  it("owns SQLite on one dedicated thread with a bounded queue", () => {
    const database = read("crates/platform/src/database.rs");

    expect(database).toContain('name("code-agent-sqlite"');
    expect(database).toContain("mpsc::sync_channel::<DatabaseJob>");
    expect(database).toContain("try_send");
    expect(database).toContain("connection.backup");
    expect(database).toContain("PRAGMA foreign_key_check");
    expect(database).not.toContain("unbounded_channel");
  });

  it("uses raw attachment IPC and opaque asset URLs without base64", () => {
    const transport = read("packages/transport-tauri/src/tauri-transport.ts");
    const attachments = read("apps/desktop/src-tauri/src/commands/attachments.rs");
    const assetProtocol = read("apps/desktop/src-tauri/src/asset_protocol.rs");

    expect(transport).toContain('invoke("attachment_upload", bytes');
    expect(transport).toContain("new Uint8Array(await input.content.arrayBuffer())");
    expect(attachments).toContain("InvokeBody::Raw");
    expect(assetProtocol).toContain("project-attachment");
    expect([transport, attachments, assetProtocol].join("\n")).not.toMatch(/base64/i);
  });

  it("keeps platform paths and Git subprocesses bounded", () => {
    const platformSources = readdirSync(join(repositoryRoot, "crates/platform/src"))
      .filter((file) => file.endsWith(".rs"))
      .map((file) => read(`crates/platform/src/${file}`))
      .join("\n");

    expect(platformSources).toContain("canonicalize");
    expect(platformSources).toContain("MAX_OUTPUT_BYTES");
    expect(platformSources).toContain("kill_on_drop(true)");
    expect(platformSources).not.toContain('Command::new("sh")');
    expect(platformSources).not.toContain("unbounded_channel");
  });

  it("manages exactly one runtime and grants no renderer fs or shell wildcard", () => {
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");
    const capability = JSON.parse(read("apps/desktop/src-tauri/capabilities/main.json")) as {
      permissions: string[];
      windows: string[];
    };
    const runtimeManifest = read("crates/runtime/Cargo.toml");

    expect(desktop.match(/app\.manage\(Arc::new\(runtime\)\)/g)).toHaveLength(1);
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toEqual(["core:default", "updater:default"]);
    expect(runtimeManifest).not.toContain("tauri");
    expect(runtimeManifest).not.toContain("code-agent-platform");
  });
});
