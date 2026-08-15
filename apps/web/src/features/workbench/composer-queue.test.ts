import { describe, expect, it } from "vitest";

import {
  createAwaitingQueuedPrompt,
  reconcileAcknowledgedQueuedPrompts,
  restoreQueuedPromptContent,
} from "./composer-queue.js";

const queuedPrompt = {
  acknowledgedUserMessageIds: [],
  deliveryState: "queued" as const,
  files: [],
  id: "queued-1",
  presentation: "queue" as const,
  skills: [],
  text: "继续修复发送状态",
};

describe("composer queue acknowledgement", () => {
  it("keeps a sent steer visible until Codex returns its user message", () => {
    const waitingPrompt = createAwaitingQueuedPrompt(queuedPrompt, {
      turns: [
        {
          items: [
            {
              id: "existing-user",
              role: "user",
              text: queuedPrompt.text,
              type: "message",
            },
          ],
        },
      ],
    });

    expect(reconcileAcknowledgedQueuedPrompts([waitingPrompt], undefined)).toEqual({
      acknowledgedComposerPrompt: false,
      prompts: [waitingPrompt],
    });
    expect(
      reconcileAcknowledgedQueuedPrompts([waitingPrompt], {
        turns: [
          {
            items: [
              {
                id: "existing-user",
                role: "user",
                text: queuedPrompt.text,
                type: "message",
              },
              {
                id: "submitted-user-turn-1",
                role: "user",
                text: queuedPrompt.text,
                type: "message",
              },
            ],
          },
        ],
      }).prompts,
    ).toEqual([waitingPrompt]);
    expect(
      reconcileAcknowledgedQueuedPrompts([waitingPrompt], {
        turns: [
          {
            items: [
              {
                id: "existing-user",
                role: "user",
                text: queuedPrompt.text,
                type: "message",
              },
              {
                id: "codex-user-2",
                role: "user",
                text: queuedPrompt.text,
                type: "message",
              },
            ],
          },
        ],
      }),
    ).toEqual({ acknowledgedComposerPrompt: false, prompts: [] });
  });

  it("restores a queued message to editable composer content", () => {
    const skill = {
      description: "检查实现",
      displayName: "Review",
      id: "review",
      name: "review",
      scope: "system" as const,
    };

    expect(restoreQueuedPromptContent({ ...queuedPrompt, skills: [skill] })).toEqual([
      { skill, type: "skill" },
      { text: queuedPrompt.text, type: "text" },
    ]);
  });

  it("reports when an input-box steer has been acknowledged", () => {
    const waitingPrompt = createAwaitingQueuedPrompt(
      { ...queuedPrompt, presentation: "composer" },
      undefined,
    );

    expect(
      reconcileAcknowledgedQueuedPrompts([waitingPrompt], {
        turns: [
          {
            items: [
              {
                id: "codex-user-1",
                role: "user",
                text: queuedPrompt.text,
                type: "message",
              },
            ],
          },
        ],
      }),
    ).toEqual({ acknowledgedComposerPrompt: true, prompts: [] });
  });

  it("settles an unacknowledged steer after its target turn is interrupted", () => {
    const waitingPrompt = {
      ...createAwaitingQueuedPrompt(queuedPrompt, undefined),
      deliveryTurnId: "turn-running",
    };

    expect(
      reconcileAcknowledgedQueuedPrompts([waitingPrompt], {
        turns: [
          {
            id: "turn-running",
            items: [],
            status: "interrupted",
          },
        ],
      }),
    ).toEqual({
      acknowledgedComposerPrompt: false,
      prompts: [],
    });
  });
});
