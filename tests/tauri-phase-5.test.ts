import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

  it("locks the Codex version and disjoint notification classifications in Rust", () => {
    const rustBinary = read("crates/provider-codex/src/binary.rs");
    const rustMapping = read("crates/provider-codex/src/mapping/common.rs");
    const versionPattern = /SUPPORTED_CODEX_VERSION[^=]*=\s*["']([^"']+)["']/u;
    const mapped = rustStringSet(rustMapping, "CODEX_MAPPED_NOTIFICATION_METHODS");
    const special = rustStringSet(rustMapping, "CODEX_SPECIAL_NOTIFICATION_METHODS");
    const ignored = rustStringSet(rustMapping, "CODEX_IGNORED_NOTIFICATION_METHODS");

    expect(versionPattern.exec(rustBinary)?.[1]).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(mapped.size).toBeGreaterThan(0);
    expect(special.size).toBeGreaterThan(0);
    expect([...mapped].every((method) => !special.has(method))).toBe(true);
    expect([...mapped].every((method) => !ignored.has(method))).toBe(true);
    expect([...special].every((method) => !ignored.has(method))).toBe(true);
  });

  it("bundles the complete Codex native runtime", () => {
    const prepareScript = read("apps/desktop/scripts/prepare-codex-binary.mjs");
    const artifactCheck = read("tools/verify-desktop-artifact.mjs");
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");
    const platformAdapters = read("apps/desktop/src-tauri/src/platform_adapters.rs");
    const tauriConfig = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as {
      bundle: { externalBin: string[]; resources: Record<string, string> };
    };

    expect(prepareScript).toContain("runtimeManifest.resourcesDir");
    expect(prepareScript).toContain("runtimeManifest.pathDir");
    expect(prepareScript).toContain("runtimeManifest.entrypoint");
    expect(prepareScript).toContain('"code-agent-mcp-command-proxy"');
    expect(prepareScript).toContain('"npx.exe"');
    expect(tauriConfig.bundle.externalBin).toEqual([]);
    expect(tauriConfig.bundle.resources).toEqual({
      "resources/codex-runtime/": "codex-runtime/",
    });
    expect(artifactCheck).toContain('"codex-package.json"');
    expect(artifactCheck).toContain('"codex-resources"');
    expect(artifactCheck).toContain('"codex-path"');
    expect(artifactCheck).toContain("npx.exe");
    expect(desktop).toContain("resource_dir()");
    expect(platformAdapters).toContain("desktop_codex_environment");
    expect(platformAdapters).toContain('"PATH".to_string()');
    expect(platformAdapters).toContain('join("codex-path")');
    expect(desktop).toContain("resolved_process_path");
  });

  it("injects one resolved host tool environment into desktop services", () => {
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");
    const platformAdapters = read("apps/desktop/src-tauri/src/platform_adapters.rs");

    expect(desktop.match(/resolved_process_path\(/gu)).toHaveLength(1);
    expect(desktop).toContain("ProcessEnvironment::capture_with_path");
    expect(desktop).toMatch(
      /PlatformFilePort::new\(\s*database\.clone\(\),\s*host_environment\.clone\(\),?\s*\)/u,
    );
    expect(desktop).toContain("GitCliService::new(database, host_environment)");
    expect(platformAdapters).not.toContain("resolved_process_path");
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
    expect(capability.permissions).toEqual(["core:default", "updater:default"]);
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

  it("keeps the shared realtime scenario covered by Rust mapping tests", () => {
    const mappingTest = read("crates/provider-codex/tests/mapping.rs");

    expect(mappingTest).toContain("phase5_realtime_path_should_match_shared_delivery_fixture");
    expect(mappingTest).toContain("tests/fixtures/phase5/realtime-path.json");
  });

  it("forwards request and idempotency identities through every Runtime mutation command", () => {
    const commands = {
      "attachments.rs": ["attachment_import_host", "attachment_open"],
      "files.rs": ["project_open"],
      "git.rs": [
        "git_branch_create",
        "git_branch_switch",
        "git_commit",
        "git_commit_message_generate",
      ],
      "projects.rs": ["project_add", "project_remove", "project_rename", "project_reorder"],
      "provider.rs": [
        "provider_custom_configure",
        "provider_login_cancel",
        "provider_login_start",
        "provider_logout",
      ],
      "settings.rs": ["global_settings_update", "project_defaults_update", "task_settings_update"],
      "tasks.rs": [
        "feedback_upload",
        "mcp_servers_retry",
        "task_archive",
        "task_compact",
        "task_fork",
        "task_pin",
        "task_rename",
        "task_review",
        "task_start",
        "task_unsubscribe",
        "terminal_terminate",
      ],
      "turns.rs": ["pending_request_resolve", "turn_interrupt", "turn_start", "turn_steer"],
    } as const;

    for (const [file, names] of Object.entries(commands)) {
      const source = read(`apps/desktop/src-tauri/src/commands/${file}`);
      for (const name of names) {
        const command = source.split(`pub async fn ${name}(`)[1]?.split("#[tauri::command]")[0];
        expect(command, name).toContain("idempotency_key: String");
        expect(command, name).toContain("&idempotency_key");
      }
    }

    const attachments = read("apps/desktop/src-tauri/src/commands/attachments.rs");
    expect(attachments).toContain(
      'const IDEMPOTENCY_KEY_HEADER: &str = "x-code-agent-idempotency-key"',
    );
    expect(attachments).toMatch(/upload\.request_id,[\s\S]*&upload\.idempotency_key,/u);
  });
});
