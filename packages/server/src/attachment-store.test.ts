import { describe, expect, it } from "vitest";

import { AttachmentNotFoundError, AttachmentStore } from "./attachment-store.js";

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("AttachmentStore", () => {
  it("stores validated image data behind an opaque reference", () => {
    const store = new AttachmentStore({ createId: () => "attachment-1" });

    const attachment = store.add({ dataUrl: pixelDataUrl, name: "screen.png" });

    expect(attachment).toEqual({
      id: "attachment-1",
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    });
    expect(store.resolve([attachment.id])).toEqual([{ mediaType: "image/png", url: pixelDataUrl }]);
  });

  it("expires, consumes, and clears stored attachments", () => {
    let now = 1_000;
    let nextId = 1;
    const store = new AttachmentStore({
      clock: () => now,
      createId: () => `attachment-${String(nextId++)}`,
      ttlMs: 100,
    });
    const expired = store.add({ dataUrl: pixelDataUrl, name: "expired.png" });
    now = 1_101;

    expect(() => store.resolve([expired.id])).toThrow(AttachmentNotFoundError);

    const consumed = store.add({ dataUrl: pixelDataUrl, name: "consumed.png" });
    expect(store.resolve([consumed.id])).toHaveLength(1);
    store.consume([consumed.id]);
    expect(() => store.resolve([consumed.id])).toThrow(AttachmentNotFoundError);

    const cleared = store.add({ dataUrl: pixelDataUrl, name: "cleared.png" });
    store.clear();
    expect(() => store.resolve([cleared.id])).toThrow(AttachmentNotFoundError);
  });

  it("enforces decoded byte and total capacity limits", () => {
    const store = new AttachmentStore({
      createId: () => globalThis.crypto.randomUUID(),
      maxBytes: 68,
      maxEntries: 1,
      maxTotalBytes: 68,
    });
    store.add({ dataUrl: pixelDataUrl, name: "first.png" });

    expect(() => store.add({ dataUrl: pixelDataUrl, name: "second.png" })).toThrow(
      "Attachment store capacity exceeded",
    );
    expect(() =>
      new AttachmentStore({ maxBytes: 67 }).add({ dataUrl: pixelDataUrl, name: "large.png" }),
    ).toThrow("Attachment exceeds the maximum size");
  });
});
