import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CODEX_IGNORED_NOTIFICATION_METHODS,
  CODEX_MAPPED_NOTIFICATION_METHODS,
  CODEX_SPECIAL_NOTIFICATION_METHODS,
} from "../packages/provider-codex/src/codex-mapping-common.js";
import { mapCodexNotification } from "../packages/provider-codex/src/codex-event-mapping.js";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

function readRustSources(directory: string): string {
  return readdirSync(join(repositoryRoot, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rs"))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

function rustStringSet(source: string, constant: string): Set<string> {
  const match = new RegExp(`pub const ${constant}:[\\s\\S]*?= &\\[([\\s\\S]*?)\\];`, "u").exec(
    source,
  );
  if (match?.[1] === undefined) throw new Error(`Missing Rust constant ${constant}`);
  return new Set([...match[1].matchAll(/"([^"]+)"/gu)].map((item) => item[1] ?? ""));
}

describe("Tauri Phase 5 repository contract", () => {
  it("keeps Codex process and RPC buffers bounded without shell or base64 bridges", () => {
    const provider = readRustSources("crates/provider-codex/src");

    expect(provider).toContain("mpsc::channel");
    expect(provider).toContain("DEFAULT_MAX_JSONL_BYTES");
    expect(provider).toContain("kill_on_drop(true)");
    expect(provider).not.toContain("unbounded_channel");
    expect(provider).not.toContain('Command::new("sh")');
    expect(provider).not.toMatch(/\.arg\(["']-c["']\)/u);
    expect(provider).not.toMatch(/base64::|BASE64_STANDARD|\.decode_base64/u);
  });

  it("locks the same Codex version and notification classifications in Rust and TypeScript", () => {
    const rustBinary = read("crates/provider-codex/src/binary.rs");
    const tsBinary = read("packages/provider-codex/src/binary.ts");
    const rustMapping = read("crates/provider-codex/src/mapping/common.rs");
    const versionPattern = /SUPPORTED_CODEX_VERSION[^=]*=\s*["']([^"']+)["']/u;

    expect(versionPattern.exec(rustBinary)?.[1]).toBe(versionPattern.exec(tsBinary)?.[1]);
    expect(rustStringSet(rustMapping, "CODEX_MAPPED_NOTIFICATION_METHODS")).toEqual(
      CODEX_MAPPED_NOTIFICATION_METHODS,
    );
    expect(rustStringSet(rustMapping, "CODEX_SPECIAL_NOTIFICATION_METHODS")).toEqual(
      CODEX_SPECIAL_NOTIFICATION_METHODS,
    );
    expect(rustStringSet(rustMapping, "CODEX_IGNORED_NOTIFICATION_METHODS")).toEqual(
      CODEX_IGNORED_NOTIFICATION_METHODS,
    );
  });

  it("registers every Phase 5 command while keeping renderer capabilities minimal", () => {
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");
    const capability = JSON.parse(read("apps/desktop/src-tauri/capabilities/main.json")) as {
      permissions: string[];
    };
    const commands = [
      "capabilities_get",
      "models_list",
      "skills_list",
      "provider_connection_get",
      "provider_login_start",
      "provider_login_cancel",
      "provider_logout",
      "provider_custom_configure",
      "task_list",
      "task_start",
      "task_read",
      "task_pin",
      "task_rename",
      "task_archive",
      "task_unsubscribe",
      "task_fork",
      "task_compact",
      "task_review",
      "feedback_upload",
      "mcp_servers_list",
      "mcp_servers_retry",
      "terminals_list",
      "terminal_terminate",
      "turn_start",
      "turn_steer",
      "turn_interrupt",
      "pending_request_resolve",
      "event_subscribe",
      "event_unsubscribe",
      "git_commit_message_generate",
    ];

    for (const command of commands) expect(desktop).toMatch(new RegExp(`::${command}[,\\n]`, "u"));
    expect(capability.permissions).toEqual(["core:default"]);
    expect(capability.permissions.join("\n")).not.toMatch(/shell|fs:/u);
  });

  it("uses Tauri Channel envelopes and keeps Runtime host-independent", () => {
    const events = read("apps/desktop/src-tauri/src/commands/events.rs");
    const runtimeManifest = read("crates/runtime/Cargo.toml");

    expect(events).toContain("ipc::Channel");
    expect(events).toContain('"connection.ready"');
    expect(events).toContain('"resync.required"');
    expect(events).not.toMatch(/\.emit\(|listen_global/u);
    const productionDependencies =
      runtimeManifest.split("[dev-dependencies]")[0] ?? runtimeManifest;
    expect(productionDependencies).not.toMatch(
      /tauri|code-agent-platform|code-agent-provider-codex/u,
    );
  });

  it("maps the shared realtime scenario to the same domain event sequence", () => {
    const fixture = JSON.parse(read("tests/fixtures/phase5/realtime-path.json")) as {
      expectedEvents: unknown[];
      expectedEventTypes: string[];
      notifications: { method: string; params: unknown }[];
    };
    const events = fixture.notifications.map(({ method, params }) =>
      mapCodexNotification(
        method,
        params,
        () => undefined,
        () => undefined,
      ),
    );

    expect(events.every((event) => event !== undefined)).toBe(true);
    expect(events).toEqual(fixture.expectedEvents);
    expect(events.map((event) => event?.type)).toEqual(fixture.expectedEventTypes);
  });
});
