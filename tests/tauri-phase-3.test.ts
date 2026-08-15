import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

describe("Tauri Phase 3 repository contract", () => {
  it("keeps TypeBox as the only public protocol source with a read-only drift gate", () => {
    const rootPackage = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const generator = read("crates/protocol-gen/src/main.rs");
    const generationRunner = read("tools/generate-rust-protocol.mjs");
    const protocol = read("crates/protocol/src/lib.rs");

    expect(rootPackage.scripts["protocol:rust:generate"]).toContain("generate-rust-protocol.mjs");
    expect(generationRunner).toContain("CODE_AGENT_UPDATE_RUST_PROTOCOL");
    expect(generationRunner).toContain("shell: false");
    expect(rootPackage.scripts["protocol:rust:check"]).toContain("--check");
    expect(rootPackage.scripts["check:ci:quality"]).toContain("protocol:rust:check");
    expect(generator).toContain("TypeSpace::new");
    expect(protocol).toContain('"../../../schemas/code-agent-runtime.schema.json"');
  });

  it("keeps runtime host-independent and all queues bounded", () => {
    const manifest = read("crates/runtime/Cargo.toml");
    const sources = ["builder.rs", "control.rs", "event_stream.rs", "idempotency.rs", "lib.rs"]
      .map((file) => read(`crates/runtime/src/${file}`))
      .join("\n");

    expect(manifest).not.toContain("tauri");
    expect(manifest).not.toContain("napi");
    expect(manifest).not.toContain("code-agent-platform");
    expect(manifest).not.toContain("code-agent-provider-codex");
    expect(sources).not.toContain("unbounded_channel");
    expect(sources).toContain("mpsc::channel");
    expect(sources).toContain("max_retained_bytes");
    expect(sources).toContain("TaskTracker");
    expect(sources).toContain("CancellationToken");
  });

  it("keeps provider events free from runtime transport fields", () => {
    const schemaSource = read("packages/protocol/src/rust-runtime-schema.ts");
    const eventStream = read("crates/runtime/src/event_stream.rs");

    expect(schemaSource).toContain('"sequence"');
    expect(schemaSource).toContain('"sessionId"');
    expect(schemaSource).toContain("Type.Omit");
    expect(eventStream).toContain('object.insert("sequence"');
    expect(eventStream).toContain('"sessionId".to_owned()');
    expect(eventStream).toContain('object.insert("version"');
  });
});
