import { describe, expect, it } from "vitest";

import { createComposerDraftScope, createComposerDraftStore } from "./composer-draft-context.js";

describe("ComposerDraftStore", () => {
  it("keeps queued follow-up messages isolated by task scope", () => {
    const store = createComposerDraftStore();
    const firstScope = createComposerDraftScope("code-agent", "task-1");
    const secondScope = createComposerDraftScope("code-agent", "task-2");

    store.update(firstScope, (draft) => ({
      ...draft,
      queuedPrompts: [
        {
          fileReferences: [{ name: "main.tsx", path: "src/main.tsx" }],
          files: [],
          id: "queued-1",
          skills: [],
          text: "稍后执行测试",
        },
      ],
    }));

    expect(store.read(firstScope).queuedPrompts).toEqual([
      {
        fileReferences: [{ name: "main.tsx", path: "src/main.tsx" }],
        files: [],
        id: "queued-1",
        skills: [],
        text: "稍后执行测试",
      },
    ]);
    expect(store.read(secondScope).queuedPrompts).toEqual([]);
  });
});
