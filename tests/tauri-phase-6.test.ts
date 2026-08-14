import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

describe("Tauri Phase 6 repository contract", () => {
  it("enforces a strict local-only CSP", () => {
    const config = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as {
      app: { security: { csp: string | null } };
    };
    const csp = config.app.security.csp;

    expect(csp).toBeTypeOf("string");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src ipc: http://ipc.localhost");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/https:\/\/\*|http:\/\/\*|script-src[^;]*unsafe-eval/u);
  });

  it("keeps renderer capabilities local and minimal", () => {
    const capability = JSON.parse(read("apps/desktop/src-tauri/capabilities/main.json")) as Record<
      string,
      unknown
    > & { permissions: string[]; windows: string[] };

    expect(capability.windows).toEqual(["main"]);
    expect(capability).not.toHaveProperty("remote");
    expect(capability.permissions).toEqual(["core:default", "updater:default"]);
    expect(capability.permissions.join("\n")).not.toMatch(/fs:|shell|http|dialog|notification/u);
  });

  it("uses the shared Web file picker without native system dialogs", () => {
    const workspaceManifest = read("Cargo.toml");
    const desktopManifest = read("apps/desktop/src-tauri/Cargo.toml");
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");
    const hostCommands = read("apps/desktop/src-tauri/src/commands/host.rs");
    const transport = read("packages/transport-tauri/src/tauri-transport.ts");
    const combined = [workspaceManifest, desktopManifest, desktop, hostCommands, transport].join(
      "\n",
    );

    expect(combined).not.toContain("tauri-plugin-dialog");
    expect(combined).not.toContain("host_directory_select");
    expect(combined).not.toContain("host_files_select");
    expect(combined).not.toContain("host.directory_select");
    expect(combined).not.toContain("host.files_select");
  });

  it("keeps Node CLI and Desktop on one data root across host restarts", () => {
    const cli = read("apps/node-cli/src/cli-command.ts");
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");

    expect(cli).toContain('join(homedir(), ".code-agent")');
    expect(desktop).toContain('home.join(".code-agent")');
    expect(cli).not.toMatch(/join\(codexHome,\s*"code-agent"/u);
    expect(desktop).not.toContain("app_data_dir()");
    expect(desktop).not.toMatch(/CODEX_HOME[\s\S]{0,120}join\("code-agent"\)/u);
  });

  it("rejects remote navigation and release DevTools", () => {
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");
    const manifest = read("apps/desktop/src-tauri/Cargo.toml");

    expect(desktop).toContain("navigation_guard_plugin");
    expect(desktop).toContain("on_navigation");
    expect(desktop).toContain('url.scheme() == "tauri"');
    expect(desktop).toContain('host == Some("tauri.localhost")');
    expect(manifest).not.toMatch(/tauri\s*=.*devtools/u);
  });

  it("registers single-instance first and owns shutdown in one lifecycle", () => {
    const desktop = read("apps/desktop/src-tauri/src/lib.rs");
    const lifecycle = read("apps/desktop/src-tauri/src/lifecycle.rs");
    const firstPlugin = desktop.indexOf(".plugin(");

    expect(desktop.slice(firstPlugin, firstPlugin + 120)).toContain("single_instance");
    expect(desktop).toContain('get_webview_window("main")');
    expect(desktop).toContain("window.unminimize()");
    expect(desktop).toContain("window.set_focus()");
    expect(desktop).not.toContain("TrayIcon");
    expect(lifecycle).toContain("DesktopLifecycle");
    expect(lifecycle).toContain("compare_exchange");
    expect(lifecycle.indexOf("subscriptions.close")).toBeLessThan(
      lifecycle.indexOf("runtime.shutdown"),
    );
    expect(lifecycle.indexOf("runtime.shutdown")).toBeLessThan(
      lifecycle.indexOf("supervisor.close"),
    );
  });

  it("returns a correlation ID without leaking internal diagnostics", () => {
    const error = read("apps/desktop/src-tauri/src/command_error.rs");
    const client = read("packages/client/src/errors.ts");

    expect(error).toContain("correlation_id");
    expect(error).toContain("Uuid::new_v4");
    expect(error).toMatch(/error\s*\.correlation_id\(\)/u);
    expect(client).toContain("correlationId");
    expect(error).not.toMatch(/backtrace|stderr_tail/u);
  });
});
