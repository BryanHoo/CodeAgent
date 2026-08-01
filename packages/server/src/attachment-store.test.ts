import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AttachmentNotFoundError, AttachmentStore } from "./attachment-store.js";

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pastedTextDataUrl = "data:text/plain;base64,5L2g5aW9IENvZGVBZ2VudA==";
const pdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";

describe("AttachmentStore", () => {
  it("stores validated image data behind an opaque reference", () => {
    const store = new AttachmentStore({ createId: () => "attachment-1" });

    const attachment = store.add("code-agent", {
      dataUrl: pixelDataUrl,
      kind: "image",
      name: "screen.png",
    });

    expect(attachment).toEqual({
      id: "attachment-1",
      kind: "image",
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    });
    expect(store.resolve("code-agent", [attachment.id])).toEqual([
      { kind: "image", mediaType: "image/png", size: 68, url: pixelDataUrl },
    ]);
    expect(() => store.resolve("other", [attachment.id])).toThrow(AttachmentNotFoundError);
  });

  it("stores pasted UTF-8 text as a bounded text attachment", () => {
    const store = new AttachmentStore({ createId: () => "attachment-text" });

    const attachment = store.add("code-agent", {
      dataUrl: pastedTextDataUrl,
      kind: "text",
      name: "Pasted text.txt",
    });

    expect(attachment).toEqual({
      id: "attachment-text",
      kind: "text",
      mediaType: "text/plain",
      name: "Pasted text.txt",
      size: 16,
    });
    expect(store.resolve("code-agent", [attachment.id])).toEqual([
      {
        mediaType: "text/plain",
        kind: "text",
        name: "Pasted text.txt",
        size: 16,
        text: "你好 CodeAgent",
      },
    ]);
  });

  it("materializes supported files for Codex mention inputs", () => {
    const store = new AttachmentStore({
      attachmentDirectory: join(tmpdir(), `code-agent-attachment-test-${crypto.randomUUID()}`),
      createId: () => "attachment-file",
    });

    const attachment = store.add("code-agent", {
      dataUrl: pdfDataUrl,
      kind: "file",
      name: "specification.pdf",
    });
    const [resolved] = store.resolve("code-agent", [attachment.id]);

    expect(attachment).toMatchObject({
      kind: "file",
      mediaType: "application/pdf",
      name: "specification.pdf",
      size: 8,
    });
    expect(resolved).toMatchObject({
      kind: "file",
      mediaType: "application/pdf",
      name: "specification.pdf",
    });
    if (resolved?.kind !== "file") {
      throw new Error("Expected a materialized file attachment");
    }
    expect(existsSync(resolved.path)).toBe(true);
    expect(readFileSync(resolved.path, "utf8")).toBe("%PDF-1.4");

    store.consume("code-agent", [attachment.id], "turn-file");
    expect(() => store.resolve("code-agent", [attachment.id])).toThrow(AttachmentNotFoundError);
    store.releaseTurn("other-project", "turn-file");
    expect(existsSync(resolved.path)).toBe(true);
    store.releaseTurn("code-agent", "turn-file");
    expect(existsSync(resolved.path)).toBe(false);

    store.dispose();
    expect(existsSync(resolved.path)).toBe(false);
  });

  it("expires, consumes, and clears stored attachments", () => {
    let now = 1_000;
    let nextId = 1;
    const store = new AttachmentStore({
      clock: () => now,
      createId: () => `attachment-${String(nextId++)}`,
      ttlMs: 100,
    });
    const expired = store.add("code-agent", {
      dataUrl: pixelDataUrl,
      kind: "image",
      name: "expired.png",
    });
    now = 1_101;

    expect(() => store.resolve("code-agent", [expired.id])).toThrow(AttachmentNotFoundError);

    const consumed = store.add("code-agent", {
      dataUrl: pixelDataUrl,
      kind: "image",
      name: "consumed.png",
    });
    expect(store.resolve("code-agent", [consumed.id])).toHaveLength(1);
    store.consume("code-agent", [consumed.id]);
    expect(() => store.resolve("code-agent", [consumed.id])).toThrow(AttachmentNotFoundError);

    const cleared = store.add("code-agent", {
      dataUrl: pixelDataUrl,
      kind: "image",
      name: "cleared.png",
    });
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
    store.add("code-agent", { dataUrl: pixelDataUrl, kind: "image", name: "first.png" });

    expect(() =>
      store.add("code-agent", { dataUrl: pixelDataUrl, kind: "image", name: "second.png" }),
    ).toThrow("Attachment store capacity exceeded");
    expect(() =>
      new AttachmentStore({ maxBytes: 67 }).add("code-agent", {
        dataUrl: pixelDataUrl,
        kind: "image",
        name: "large.png",
      }),
    ).toThrow("Attachment exceeds the maximum size");
  });
});
