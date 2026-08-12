import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

describe("Tauri Phase 7 repository contract", () => {
  it("configures node-binding as a napi-rs cdylib", () => {
    const manifest = read("crates/node-binding/Cargo.toml");
    const bindingSource = read("crates/node-binding/src/lib.rs");

    expect(manifest).toContain('crate-type = ["cdylib"]');
    expect(manifest).toContain("napi.workspace = true");
    expect(manifest).toContain("napi-derive.workspace = true");
    expect(manifest).toContain("napi-build.workspace = true");
    expect(manifest).not.toMatch(/\[lints\][\s\S]*workspace = true/);
    expect(bindingSource).not.toMatch(/\bunsafe\b/);
  });

  it("provides a private engine-node workspace package", () => {
    const manifest = JSON.parse(read("packages/engine-node/package.json")) as {
      name?: string;
      private?: boolean;
    };

    expect(manifest.name).toBe("@code-agent/engine-node");
    expect(manifest.private).toBe(true);
  });

  it("defines native build and Phase 7 gate scripts", () => {
    const manifest = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

    expect(manifest.scripts?.["build:native"]).toContain("build-native-addon.mjs");
    expect(manifest.scripts?.["tauri:phase7:check"]).toContain("tauri-phase-7.test.ts");
  });

  it("exposes a named Node Engine lifecycle without a generic dispatcher", () => {
    const engine = read("crates/node-binding/src/engine.rs");

    expect(engine).toContain("pub struct NodeEngine");
    expect(engine).toMatch(/pub async fn open/);
    expect(engine).toMatch(/pub async fn diagnose/);
    expect(engine).toMatch(/pub async fn cancel_operation/);
    expect(engine).toMatch(/pub async fn wait_for_exit/);
    expect(engine).toMatch(/pub async fn close/);
    expect(engine).not.toMatch(/pub async fn (execute|request|invoke)\b/);
  });

  it("uses a bounded weak nonblocking N-API event bridge", () => {
    const events = read("crates/node-binding/src/events.rs");

    expect(events).toContain("max_queue_size::<1>()");
    expect(events).toContain("weak::<true>()");
    expect(events).toContain("callback.call_async(bytes)");
    expect(events).toContain("event.frame().to_vec()");
    expect(events).not.toContain("ThreadsafeFunctionCallMode::Blocking");
  });

  it("keeps Fastify as delivery and injects only the Node engine", () => {
    const options = read("packages/server/src/server-options.ts");
    const app = read("packages/server/src/app.ts");
    const context = read("packages/server/src/routes/context.ts");

    expect(options).toContain("readonly engine: CodeAgentEngine");
    expect(options).not.toMatch(/ProjectRepository|AgentRuntimeProvider|AgentSettingsRepository/);
    expect(app).not.toMatch(/@code-agent\/(core|provider-codex)/);
    expect(context).not.toMatch(/@code-agent\/(core|provider-codex)/);
    expect(context).toContain("readonly engine: CodeAgentEngine");
  });

  it("removes the duplicate TypeScript runtime and native SQLite dependency", () => {
    const manifest = read("package.json");
    const workspace = read("pnpm-workspace.yaml");

    expect(existsSync(resolve(root, "packages/core/package.json"))).toBe(false);
    expect(existsSync(resolve(root, "packages/provider-codex/package.json"))).toBe(false);
    expect(manifest).not.toContain("better-sqlite3");
    expect(workspace).not.toContain("better-sqlite3");
  });
});
