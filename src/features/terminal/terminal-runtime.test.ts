import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalRuntime } from "./terminal-runtime.js";
import { TerminalStore } from "./terminal-store.js";
import type { TerminalMetadata } from "../../protocol/project-terminal.js";

const metadata: TerminalMetadata = { projectId: "p", rootId: "r", terminalId: "t", generation: "g", title: "sh", state: "running", cols: 80, rows: 24, exitCode: null };

function outputFrame(sequence: bigint): ArrayBuffer {
  const buffer = new ArrayBuffer(17);
  new DataView(buffer).setBigUint64(0, sequence, true);
  new DataView(buffer).setBigUint64(8, sequence, true);
  new Uint8Array(buffer)[16] = 65;
  return buffer;
}

describe("terminal runtime", () => {
  afterEach(() => vi.useRealTimers());
  it("closes a native creation that completes after disposal", async () => {
    let complete: (value: { metadata: TerminalMetadata; dispose: () => void }) => void = () => undefined;
    const release = vi.fn();
    const client = {
      connect: vi.fn(async (snapshot) => { snapshot({ generation: "g", sequence: "0", terminals: [] }); return vi.fn(); }),
      create: vi.fn(() => new Promise<{ metadata: TerminalMetadata; dispose: () => void }>((resolve) => { complete = resolve; })),
      write: vi.fn(async () => undefined), ack: vi.fn(async () => undefined), resize: vi.fn(async () => undefined), close: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    };
    const emulator = { write: vi.fn(), attach: vi.fn(), detach: vi.fn(), focus: vi.fn(), setExited: vi.fn(), dispose: vi.fn() };
    const runtime = new TerminalRuntime({ client, store: new TerminalStore(), factory: async () => emulator });
    const creation = runtime.create("p", "r");
    await vi.waitFor(() => expect(client.create).toHaveBeenCalledOnce());
    runtime.dispose();
    complete({ metadata, dispose: release });
    await creation;
    expect(client.close).toHaveBeenCalledWith(metadata);
    expect(release).toHaveBeenCalledOnce();
    expect(emulator.dispose).toHaveBeenCalledOnce();
  });
  it("deduplicates creation and parses startup output without notifying metadata consumers", async () => {
    vi.useFakeTimers();
    let output: ((buffer: ArrayBuffer) => void) | undefined;
    const host = {} as HTMLElement;
    const client = {
      connect: vi.fn(async (snapshot) => { snapshot({ generation: "g", sequence: "0", terminals: [] }); return vi.fn(); }),
      create: vi.fn(async (_request, receive) => { output = receive; receive(outputFrame(1n)); runtime.attach("t", host); return { metadata, dispose: vi.fn() }; }),
      write: vi.fn(async () => undefined), ack: vi.fn(async () => undefined), resize: vi.fn(async () => undefined), close: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    };
    const emulator = { write: vi.fn((_bytes: Uint8Array, parsed: () => void) => parsed()), attach: vi.fn(), detach: vi.fn(), focus: vi.fn(), setExited: vi.fn(), dispose: vi.fn() };
    const factory = vi.fn(async () => emulator);
    const store = new TerminalStore();
    const runtime = new TerminalRuntime({ client, store, factory });
    await Promise.all([runtime.create("p", "r"), runtime.create("p", "r")]);
    expect(client.create).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledOnce();
    expect(emulator.write).toHaveBeenCalledOnce();
    expect(emulator.attach).toHaveBeenCalledWith(host);
    const listener = vi.fn();
    store.subscribe("p", listener);
    output?.(outputFrame(2n));
    await vi.advanceTimersByTimeAsync(8);
    expect(listener).not.toHaveBeenCalled();
    expect(client.ack).toHaveBeenLastCalledWith(metadata, "2");
    runtime.dispose();
    expect(emulator.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
