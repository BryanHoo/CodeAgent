import { describe, expect, it } from "vitest";

import { createComposerDraftScope, createComposerDraftStore } from "./composer-draft-context.js";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("ComposerDraftStore", () => {
  it("keeps queued follow-up messages isolated by task scope", () => {
    const store = createComposerDraftStore();
    const firstScope = createComposerDraftScope("code-agent", "task-1");
    const secondScope = createComposerDraftScope("code-agent", "task-2");

    store.update(firstScope, (draft) => ({
      ...draft,
      queuedPrompts: [
        {
          acknowledgedUserMessageIds: [],
          deliveryState: "queued",
          files: [],
          id: "queued-1",
          presentation: "queue",
          skills: [],
          text: "稍后执行测试",
        },
      ],
    }));

    expect(store.read(firstScope).queuedPrompts).toEqual([
      {
        acknowledgedUserMessageIds: [],
        deliveryState: "queued",
        files: [],
        id: "queued-1",
        presentation: "queue",
        skills: [],
        text: "稍后执行测试",
      },
    ]);
    expect(store.read(secondScope).queuedPrompts).toEqual([]);
  });

  it("restores queued follow-up messages after the store is recreated", () => {
    const storage = createMemoryStorage();
    const scope = createComposerDraftScope("code-agent", "task-1");
    const firstStore = createComposerDraftStore(storage);
    const attachment = {
      id: "attachment-1",
      kind: "file" as const,
      mediaType: "text/plain",
      name: "notes.txt",
      size: 12,
    };
    firstStore.update(scope, (draft) => ({
      ...draft,
      queuedPrompts: [
        {
          acknowledgedUserMessageIds: [],
          deliveryState: "awaiting_acknowledgement",
          deliveryTurnId: "turn-running",
          files: [
            {
              attachment,
              ...attachment,
              previewUrl: "",
              source: "host",
            },
          ],
          id: "queued-persisted",
          presentation: "queue",
          skills: [],
          text: "刷新后继续发送",
        },
      ],
    }));
    firstStore.dispose();

    expect(createComposerDraftStore(storage).read(scope).queuedPrompts).toEqual([
      expect.objectContaining({
        deliveryState: "awaiting_acknowledgement",
        deliveryTurnId: "turn-running",
        files: [expect.objectContaining({ attachment, source: "host" })],
        id: "queued-persisted",
        text: "刷新后继续发送",
      }),
    ]);
  });
});
