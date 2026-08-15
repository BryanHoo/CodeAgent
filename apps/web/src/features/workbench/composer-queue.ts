import type { AgentItem, AgentMessageAttachment } from "@code-agent/protocol";

import type { PromptInputAttachment } from "../../shared/components/agent/prompt-input.js";
import type { QueuedComposerPrompt } from "./composer-draft-context.js";
import type { PromptSkillContent } from "./components/prompt-skill-editor.js";

type QueueSnapshot = Readonly<{
  turns: readonly Readonly<{
    id?: string;
    items: readonly AgentItem[];
    status?: "completed" | "failed" | "interrupted" | "running";
  }>[];
}>;
type UserMessage = Extract<AgentItem, { type: "message" }> & Readonly<{ role: "user" }>;

function isAuthoritativeUserMessage(item: AgentItem): item is UserMessage {
  return item.type === "message" && item.role === "user" && !item.id.startsWith("submitted-user-");
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchesQueuedPrompt(item: AgentItem, prompt: QueuedComposerPrompt): boolean {
  if (!isAuthoritativeUserMessage(item) || item.text !== prompt.text) return false;
  const queuedSkillNames = prompt.skills.map((skill) => skill.name);
  const itemSkillNames = (item.skills ?? []).map((skill) => skill.name);
  const queuedAttachments = prompt.files.map(
    (file) => `${file.kind}:${file.name}:${String(file.size)}`,
  );
  const itemAttachments = (item.attachments ?? []).map(
    (attachment) => `${attachment.kind}:${attachment.name}:${String(attachment.size)}`,
  );
  return (
    sameOrderedValues(queuedSkillNames, itemSkillNames) &&
    sameOrderedValues(queuedAttachments, itemAttachments)
  );
}

function matchingUserMessageIds(
  prompt: QueuedComposerPrompt,
  snapshot: QueueSnapshot | undefined,
): readonly string[] {
  if (snapshot === undefined) return [];
  return snapshot.turns.flatMap((turn) =>
    turn.items.flatMap((item) => (matchesQueuedPrompt(item, prompt) ? [item.id] : [])),
  );
}

export function createAwaitingQueuedPrompt(
  prompt: QueuedComposerPrompt,
  snapshot: QueueSnapshot | undefined,
  deliveryTurnId?: string,
): QueuedComposerPrompt {
  return {
    ...prompt,
    acknowledgedUserMessageIds: matchingUserMessageIds(prompt, snapshot),
    deliveryState: "awaiting_acknowledgement",
    ...(deliveryTurnId === undefined ? {} : { deliveryTurnId }),
  };
}

function deliveryTurnFinishedWithoutAcknowledgement(
  prompt: QueuedComposerPrompt,
  snapshot: QueueSnapshot | undefined,
): boolean {
  if (prompt.deliveryTurnId === undefined || snapshot === undefined) return false;
  const deliveryTurn = snapshot.turns.find((turn) => turn.id === prompt.deliveryTurnId);
  return deliveryTurn?.status === "failed" || deliveryTurn?.status === "interrupted";
}

export function reconcileAcknowledgedQueuedPrompts(
  prompts: readonly QueuedComposerPrompt[],
  snapshot: QueueSnapshot | undefined,
): Readonly<{
  acknowledgedComposerPrompt: boolean;
  prompts: readonly QueuedComposerPrompt[];
}> {
  let acknowledgedComposerPrompt = false;
  let changed = false;
  const remaining: QueuedComposerPrompt[] = [];
  for (const prompt of prompts) {
    if (prompt.deliveryState !== "awaiting_acknowledgement") {
      remaining.push(prompt);
      continue;
    }
    const acknowledgedIds = new Set(prompt.acknowledgedUserMessageIds);
    const acknowledged = matchingUserMessageIds(prompt, snapshot).some(
      (itemId) => !acknowledgedIds.has(itemId),
    );
    if (acknowledged) {
      changed = true;
      acknowledgedComposerPrompt ||= prompt.presentation === "composer";
      continue;
    }
    if (!deliveryTurnFinishedWithoutAcknowledgement(prompt, snapshot)) {
      remaining.push(prompt);
      continue;
    }

    changed = true;
    // Turn 终态关闭了确认窗口；steer 已被服务端接受，不能因缺少 Item 再次重复投递。
    acknowledgedComposerPrompt ||= prompt.presentation === "composer";
  }
  return {
    acknowledgedComposerPrompt,
    prompts: changed ? remaining : prompts,
  };
}

export function restoreQueuedPromptContent(prompt: QueuedComposerPrompt): PromptSkillContent {
  return [
    ...prompt.skills.map((skill) => ({ skill, type: "skill" as const })),
    ...(prompt.text === "" ? [] : [{ text: prompt.text, type: "text" as const }]),
  ];
}

export function createManagedPromptAttachments(
  files: readonly PromptInputAttachment[],
  uploaded: readonly AgentMessageAttachment[],
): readonly PromptInputAttachment[] {
  return files.map((file, index) => {
    if (file.source === "host") return file;
    const attachment = uploaded.at(index);
    if (attachment === undefined) {
      throw new TypeError("Uploaded attachment metadata is missing");
    }
    return {
      attachment,
      ...attachment,
      previewUrl: file.previewUrl.startsWith("blob:") ? "" : file.previewUrl,
      source: "host" as const,
    };
  });
}
