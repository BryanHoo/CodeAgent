import { describe, expect, it } from "vitest";

import { createComposerDraftScope, createComposerDraftStore } from "./composer-draft-context.js";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
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
          files: [],
          id: "queued-1",
          skills: [],
          status: "queued",
          text: "稍后执行测试",
        },
      ],
    }));

    expect(store.read(firstScope).queuedPrompts).toEqual([
      {
        files: [],
        id: "queued-1",
        skills: [],
        status: "queued",
        text: "稍后执行测试",
      },
    ]);
    expect(store.read(secondScope).queuedPrompts).toEqual([]);
  });

  it("restores queued follow-up messages after the web store is recreated", () => {
    const storage = createMemoryStorage();
    const scope = createComposerDraftScope("code-agent", "task-1");
    const firstStore = createComposerDraftStore(storage);

    firstStore.update(scope, (draft) => ({
      ...draft,
      queuedPrompts: [
        {
          files: [],
          id: "queued-persisted",
          skills: [],
          status: "queued",
          text: "刷新后继续发送",
        },
      ],
    }));

    expect(createComposerDraftStore(storage).read(scope).queuedPrompts).toEqual([
      {
        files: [],
        id: "queued-persisted",
        skills: [],
        status: "queued",
        text: "刷新后继续发送",
      },
    ]);
  });
});
