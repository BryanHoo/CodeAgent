import { describe, expect, it } from "vitest";

import type { QueuedComposerPrompt } from "./composer-draft-context.js";
import {
  hasQueuedPromptReceivedAssistantResponse,
  resolveQueuedPromptEdit,
} from "./composer-queue-state.js";

const waitingPrompt: QueuedComposerPrompt = {
  assistantMessages: [{ id: "assistant-before", textLength: 2 }],
  files: [],
  id: "steer-1",
  skills: [],
  status: "awaiting-response",
  text: "补充失败测试",
  turnId: "turn-1",
};

const queuedPrompt: QueuedComposerPrompt = {
  files: [],
  id: "queued-1",
  skills: [],
  status: "queued",
  text: "补充失败测试",
};

function createSnapshot(assistantIds: readonly string[]) {
  return {
    turns: [
      {
        id: "turn-1",
        items: assistantIds.map((id) => ({
          id,
          role: "assistant" as const,
          text: "回复",
          type: "message" as const,
        })),
      },
    ],
  };
}

describe("composer queue state", () => {
  it("keeps an accepted steer visible until a new assistant message starts streaming", () => {
    expect(
      hasQueuedPromptReceivedAssistantResponse(waitingPrompt, createSnapshot(["assistant-before"])),
    ).toBe(false);
    expect(
      hasQueuedPromptReceivedAssistantResponse(
        waitingPrompt,
        createSnapshot(["assistant-before", "assistant-after"]),
      ),
    ).toBe(true);
    expect(
      hasQueuedPromptReceivedAssistantResponse(waitingPrompt, {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "assistant-before",
                role: "assistant",
                text: "回复继续",
                type: "message",
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("allows editing only before a queued prompt is accepted as a steer", () => {
    expect(resolveQueuedPromptEdit(queuedPrompt)).toEqual({
      files: [],
      skills: [],
      text: "补充失败测试",
    });
    expect(resolveQueuedPromptEdit(waitingPrompt)).toBeUndefined();
  });
});
