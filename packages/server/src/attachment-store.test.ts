import { describe, expect, it } from "vitest";

import { AttachmentNotFoundError, AttachmentStore } from "./attachment-store.js";

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("AttachmentStore", () => {
  it("stores validated image data behind an opaque reference", () => {
    const store = new AttachmentStore({ createId: () => "attachment-1" });

    const attachment = store.add("code-agent", { dataUrl: pixelDataUrl, name: "screen.png" });

    expect(attachment).toEqual({
      id: "attachment-1",
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    });
    expect(store.resolve("code-agent", [attachment.id])).toEqual([
      { mediaType: "image/png", url: pixelDataUrl },
    ]);
    expect(() => store.resolve("other", [attachment.id])).toThrow(AttachmentNotFoundError);
  });

  it("expires, consumes, and clears stored attachments", () => {
    let now = 1_000;
    let nextId = 1;
    const store = new AttachmentStore({
      clock: () => now,
      createId: () => `attachment-${String(nextId++)}`,
      ttlMs: 100,
    });
    const expired = store.add("code-agent", { dataUrl: pixelDataUrl, name: "expired.png" });
    now = 1_101;

    expect(() => store.resolve("code-agent", [expired.id])).toThrow(AttachmentNotFoundError);

    const consumed = store.add("code-agent", { dataUrl: pixelDataUrl, name: "consumed.png" });
    expect(store.resolve("code-agent", [consumed.id])).toHaveLength(1);
    store.consume("code-agent", [consumed.id]);
    expect(() => store.resolve("code-agent", [consumed.id])).toThrow(AttachmentNotFoundError);

    const cleared = store.add("code-agent", { dataUrl: pixelDataUrl, name: "cleared.png" });
    store.clear();
    expect(() => store.resolve("code-agent", [cleared.id])).toThrow(AttachmentNotFoundError);
  });

  it("enforces decoded byte and total capacity limits", () => {
    const store = new AttachmentStore({
      createId: () => globalThis.crypto.randomUUID(),
      maxBytes: 68,
      maxEntries: 1,
      maxTotalBytes: 68,
    });
    store.add("code-agent", { dataUrl: pixelDataUrl, name: "first.png" });

    expect(() => store.add("code-agent", { dataUrl: pixelDataUrl, name: "second.png" })).toThrow(
      "Attachment store capacity exceeded",
    );
    expect(() =>
      new AttachmentStore({ maxBytes: 67 }).add("code-agent", {
        dataUrl: pixelDataUrl,
        name: "large.png",
      }),
    ).toThrow("Attachment exceeds the maximum size");
  });
});
