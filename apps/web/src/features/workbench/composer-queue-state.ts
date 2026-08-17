import type { AgentItem } from "@code-agent/protocol";

import type { TaskStoreState } from "../conversation/runtime/task-store.js";
import type { QueuedComposerPrompt } from "./composer-draft-context.js";

export type AssistantMessageCheckpoint = Readonly<{ id: string; textLength: number }>;

export type AcceptedSteerPrompt = Readonly<{
  assistantMessages: readonly AssistantMessageCheckpoint[];
  files: QueuedComposerPrompt["files"];
  id?: string;
  skills: QueuedComposerPrompt["skills"];
  text: string;
  turnId: string;
}>;

type AssistantResponseSnapshot = Readonly<{
  turns: readonly Readonly<{ id: string; items: readonly AgentItem[] }>[];
}>;

export function retainAcceptedSteerPrompt(
  prompts: readonly QueuedComposerPrompt[],
  accepted: AcceptedSteerPrompt,
  createId: () => string,
): readonly QueuedComposerPrompt[] {
  const waitingPrompt: QueuedComposerPrompt = {
    assistantMessages: accepted.assistantMessages,
    files: accepted.files,
    id: accepted.id ?? createId(),
    skills: accepted.skills,
    status: "awaiting-response",
    text: accepted.text,
    turnId: accepted.turnId,
  };
  return accepted.id === undefined
    ? [...prompts, waitingPrompt]
    : prompts.map((prompt) => (prompt.id === accepted.id ? waitingPrompt : prompt));
}

function getAssistantMessageCheckpoints(
  items: readonly AgentItem[],
): readonly AssistantMessageCheckpoint[] {
  return items.flatMap((item) =>
    item.type === "message" && item.role === "assistant"
      ? [{ id: item.id, textLength: item.text.length }]
      : [],
  );
}

export function getTurnAssistantMessageCheckpoints(
  snapshot: AssistantResponseSnapshot | undefined,
  turnId: string | undefined,
): readonly AssistantMessageCheckpoint[] {
  if (turnId === undefined) {
    return [];
  }
  const turn = snapshot?.turns.find((candidate) => candidate.id === turnId);
  return getAssistantMessageCheckpoints(turn?.items ?? []);
}

export function getTaskStoreAssistantMessageCheckpoints(
  state: Pick<TaskStoreState, "getItem" | "itemIdsByTurnId">,
  turnId: string | undefined,
): readonly AssistantMessageCheckpoint[] {
  if (turnId === undefined) {
    return [];
  }
  return getAssistantMessageCheckpoints(
    (state.itemIdsByTurnId[turnId] ?? []).flatMap((itemId) => {
      const item = state.getItem(itemId);
      return item === undefined ? [] : [item];
    }),
  );
}

export function hasQueuedPromptReceivedAssistantCheckpoints(
  prompt: QueuedComposerPrompt,
  currentMessages: readonly AssistantMessageCheckpoint[],
): boolean {
  if (prompt.status !== "awaiting-response") {
    return false;
  }
  const previousLengths = new Map(
    prompt.assistantMessages.map((message) => [message.id, message.textLength]),
  );
  return currentMessages.some(
    (message) => message.textLength > (previousLengths.get(message.id) ?? -1),
  );
}

export function hasQueuedPromptReceivedAssistantResponse(
  prompt: QueuedComposerPrompt,
  snapshot: AssistantResponseSnapshot | undefined,
): boolean {
  if (prompt.status !== "awaiting-response") {
    return false;
  }
  return hasQueuedPromptReceivedAssistantCheckpoints(
    prompt,
    getTurnAssistantMessageCheckpoints(snapshot, prompt.turnId),
  );
}

export function resolveQueuedPromptEdit(
  prompt: QueuedComposerPrompt,
): Pick<QueuedComposerPrompt, "files" | "skills" | "text"> | undefined {
  return prompt.status === "queued"
    ? { files: prompt.files, skills: prompt.skills, text: prompt.text }
    : undefined;
}
