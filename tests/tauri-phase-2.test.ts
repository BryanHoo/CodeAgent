import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

describe("Tauri Phase 2 repository contract", () => {
  it("keeps client free from host transport implementations", () => {
    const clientSources = [
      "client.ts",
      "contracts.ts",
      "errors.ts",
      "project-client.ts",
      "task-client.ts",
    ]
      .map((file) => read(`packages/client/src/${file}`))
      .join("\n");

    expect(clientSources).not.toContain("fetch(");
    expect(clientSources).not.toContain("new WebSocket");
    expect(clientSources).not.toContain("@tauri-apps/api");
    expect(clientSources).not.toContain("/v1/");
  });

  it("registers typed diagnostics commands once in the desktop builder", () => {
    const desktopLibrary = read("apps/desktop/src-tauri/src/lib.rs");
    expect(desktopLibrary.match(/invoke_handler\(/gu)).toHaveLength(1);
    expect(desktopLibrary).toContain("commands::app::app_info");
    expect(desktopLibrary).toContain("commands::app::access_status");
    expect(desktopLibrary).toContain("commands::app::app_diagnostics");
    expect(desktopLibrary).toContain("commands::app::cancel_operation");
  });

  it("selects host transports through the only composition root", () => {
    const compositionRoot = read("apps/web/src/app/create-host-client.ts");
    const viteConfig = read("apps/web/vite.config.ts");
    expect(compositionRoot).toContain('from "@code-agent/host-transport"');
    expect(viteConfig).toContain("packages/transport-http/src/index.ts");
    expect(viteConfig).toContain("packages/transport-tauri/src/index.ts");
    expect(read("apps/web/src/main.tsx")).not.toContain("window.__TAURI__");
  });
});
