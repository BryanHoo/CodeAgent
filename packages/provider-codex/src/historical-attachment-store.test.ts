import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";

const pngContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngDataUrl = `data:image/png;base64,${pngContent.toString("base64")}`;

describe("CodexHistoricalAttachmentStore", () => {
  it("registers inline images as random metadata without exposing their data URL", async () => {
    const store = new CodexHistoricalAttachmentStore({ createId: () => "history-random-1" });

    const attachment = store.addDataUrl("task-1", { name: "diagram.png", url: pngDataUrl }, 0);

    expect(attachment).toEqual({
      id: "history-random-1",
      kind: "image",
      mediaType: "image/png",
      name: "diagram.png",
      size: pngContent.byteLength,
    });
    expect(attachment).not.toHaveProperty("url");
    await expect(store.read("task-other", "history-random-1")).resolves.toBeUndefined();
    await expect(store.read("task-1", "history-random-1")).resolves.toMatchObject({
      content: pngContent,
      mediaType: "image/png",
      name: "diagram.png",
      size: pngContent.byteLength,
    });
  });

  it("defers local image body reads and revalidates the file asynchronously on demand", async () => {
    let completeRead: ((content: Buffer) => void) | undefined;
    const readFile = vi.fn(
      () =>
        new Promise<Buffer>((resolve) => {
          completeRead = resolve;
        }),
    );
    const store = new CodexHistoricalAttachmentStore({
      createId: () => "history-local-1",
      readFile,
      readHeader: () => pngContent,
      readStats: () => Promise.resolve({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
      statFile: () => ({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
    });

    const attachment = store.addLocalImage("task-1", "/private/diagram.png", 0);

    expect(attachment).toEqual({
      id: "history-local-1",
      kind: "image",
      mediaType: "image/png",
      name: "diagram.png",
      size: pngContent.byteLength,
    });
    expect(readFile).not.toHaveBeenCalled();
    const pendingRead = store.read("task-1", "history-local-1");
    await Promise.resolve();
    expect(readFile).toHaveBeenCalledOnce();
    let settled = false;
    void pendingRead.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    completeRead?.(pngContent);
    await expect(pendingRead).resolves.toMatchObject({ content: pngContent });
  });

  it("rejects local images changed after registration", async () => {
    let mtimeMs = 100;
    const readFile = vi.fn(() => pngContent);
    const changedMetadataStore = new CodexHistoricalAttachmentStore({
      createId: () => "history-local-metadata",
      readFile: () => Promise.resolve(readFile()),
      readHeader: () => pngContent,
      readStats: () => Promise.resolve({ isFile: true, mtimeMs, size: pngContent.byteLength }),
      statFile: () => ({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
    });
    const metadataAttachment = changedMetadataStore.addLocalImage(
      "task-1",
      "/private/diagram.png",
      0,
    );

    mtimeMs = 101;
    await expect(
      changedMetadataStore.read("task-1", metadataAttachment?.id ?? ""),
    ).resolves.toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();

    const changedContentStore = new CodexHistoricalAttachmentStore({
      createId: () => "history-local-content",
      readFile: () => Promise.resolve(Buffer.from("not-png!")),
      readHeader: () => pngContent,
      readStats: () => Promise.resolve({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
      statFile: () => ({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
    });
    const contentAttachment = changedContentStore.addLocalImage(
      "task-1",
      "/private/diagram.png",
      0,
    );

    await expect(
      changedContentStore.read("task-1", contentAttachment?.id ?? ""),
    ).resolves.toBeUndefined();
  });

  it("enforces entry, total-byte, TTL, and task cleanup bounds", async () => {
    let now = 100;
    let nextId = 0;
    const store = new CodexHistoricalAttachmentStore({
      clock: () => now,
      createId: () => `history-${String(++nextId)}`,
      maxEntries: 2,
      maxTotalBytes: pngContent.byteLength * 2,
      ttlMs: 50,
    });

    const first = store.addDataUrl("task-1", { name: "first.png", url: pngDataUrl }, 0);
    const second = store.addDataUrl("task-1", { name: "second.png", url: pngDataUrl }, 1);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(store.addDataUrl("task-1", { name: "third.png", url: pngDataUrl }, 2)).toBeUndefined();
    store.clearTask("task-1");
    await expect(store.read("task-1", first?.id ?? "")).resolves.toBeUndefined();

    const expiring = store.addDataUrl("task-2", { name: "expiring.png", url: pngDataUrl }, 0);
    now = 151;
    await expect(store.read("task-2", expiring?.id ?? "")).resolves.toBeUndefined();
  });

  it("rejects invalid signatures and images over the per-file limit", () => {
    const store = new CodexHistoricalAttachmentStore({ maxBytes: pngContent.byteLength - 1 });
    const invalidDataUrl = `data:image/png;base64,${Buffer.from("not-png").toString("base64")}`;

    expect(store.addDataUrl("task-1", { name: "large.png", url: pngDataUrl }, 0)).toBeUndefined();
    expect(
      store.addDataUrl("task-1", { name: "invalid.png", url: invalidDataUrl }, 1),
    ).toBeUndefined();
  });
});
