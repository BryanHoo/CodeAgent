import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { AgentAttachment, AgentSkill } from "@code-agent/protocol";

import type { PromptInputAttachment } from "../../shared/components/agent/prompt-input.js";
import type { PromptSkillContent } from "./components/prompt-skill-editor.js";

export type QueuedComposerPrompt = Readonly<{
  acknowledgedUserMessageIds: readonly string[];
  deliveryState: "awaiting_acknowledgement" | "queued";
  deliveryTurnId?: string;
  files: readonly PromptInputAttachment[];
  id: string;
  presentation: "composer" | "queue";
  skills: readonly AgentSkill[];
  text: string;
}>;

export type ComposerDraft = Readonly<{
  attachments: readonly PromptInputAttachment[];
  content: PromptSkillContent;
  queuedPrompts: readonly QueuedComposerPrompt[];
}>;

const emptyComposerDraft: ComposerDraft = {
  attachments: [],
  content: [],
  queuedPrompts: [],
};

export type ComposerDraftStorage = Readonly<{
  getItem: (key: string) => string | null;
  removeItem: (key: string) => unknown;
  setItem: (key: string, value: string) => unknown;
}>;

type ComposerDraftStore = Readonly<{
  clear: (scope: string) => void;
  dispose: () => void;
  read: (scope: string) => ComposerDraft;
  update: (scope: string, update: (draft: ComposerDraft) => ComposerDraft) => void;
}>;

const ComposerDraftContext = createContext<ComposerDraftStore | undefined>(undefined);
const COMPOSER_QUEUE_STORAGE_PREFIX = "code-agent.composer-queue.v1:";

export function createComposerDraftScope(projectId: string, taskId?: string): string {
  return JSON.stringify([projectId, taskId ?? "draft"]);
}

function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return (
    draft.content.length === 0 && draft.attachments.length === 0 && draft.queuedPrompts.length === 0
  );
}

function draftPreviewUrls(draft: ComposerDraft): readonly string[] {
  return [
    ...draft.attachments.map((attachment) => attachment.previewUrl),
    ...draft.queuedPrompts.flatMap((prompt) =>
      prompt.files.map((attachment) => attachment.previewUrl),
    ),
  ];
}

function revokeDraftPreviews(draft: ComposerDraft) {
  for (const previewUrl of new Set(draftPreviewUrls(draft))) {
    if (previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

function revokeRemovedDraftPreviews(previousDraft: ComposerDraft, nextDraft: ComposerDraft) {
  const retainedPreviewUrls = new Set(draftPreviewUrls(nextDraft));
  for (const previewUrl of new Set(draftPreviewUrls(previousDraft))) {
    if (!retainedPreviewUrls.has(previewUrl) && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePersistedAttachment(value: unknown): AgentAttachment | undefined {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    value["id"] === "" ||
    (value["kind"] !== "file" && value["kind"] !== "image" && value["kind"] !== "text") ||
    typeof value["mediaType"] !== "string" ||
    value["mediaType"] === "" ||
    typeof value["name"] !== "string" ||
    value["name"] === "" ||
    !Number.isInteger(value["size"]) ||
    (value["size"] as number) <= 0
  ) {
    return undefined;
  }
  return {
    id: value["id"],
    kind: value["kind"],
    mediaType: value["mediaType"],
    name: value["name"],
    size: value["size"] as number,
  };
}

function parsePersistedQueuedPrompt(value: unknown): QueuedComposerPrompt | undefined {
  if (!isRecord(value) || !Array.isArray(value["files"]) || !Array.isArray(value["skills"])) {
    return undefined;
  }
  const files: PromptInputAttachment[] = [];
  for (const file of value["files"]) {
    const attachment = isRecord(file) ? parsePersistedAttachment(file["attachment"]) : undefined;
    if (
      !isRecord(file) ||
      file["source"] !== "host" ||
      attachment === undefined ||
      typeof file["previewUrl"] !== "string" ||
      Object.keys(file).some(
        (key) =>
          ![
            "attachment",
            "id",
            "kind",
            "mediaType",
            "name",
            "previewUrl",
            "size",
            "source",
          ].includes(key),
      )
    ) {
      return undefined;
    }
    files.push({ attachment, ...attachment, previewUrl: file["previewUrl"], source: "host" });
  }
  const skills: AgentSkill[] = [];
  for (const skill of value["skills"]) {
    if (
      !isRecord(skill) ||
      typeof skill["description"] !== "string" ||
      typeof skill["displayName"] !== "string" ||
      skill["displayName"] === "" ||
      typeof skill["id"] !== "string" ||
      skill["id"] === "" ||
      typeof skill["name"] !== "string" ||
      skill["name"] === "" ||
      (skill["scope"] !== "admin" &&
        skill["scope"] !== "repo" &&
        skill["scope"] !== "system" &&
        skill["scope"] !== "user")
    ) {
      return undefined;
    }
    skills.push(skill as AgentSkill);
  }
  if (
    !Array.isArray(value["acknowledgedUserMessageIds"]) ||
    !value["acknowledgedUserMessageIds"].every((id) => typeof id === "string") ||
    (value["deliveryState"] !== "queued" &&
      value["deliveryState"] !== "awaiting_acknowledgement") ||
    (value["deliveryTurnId"] !== undefined &&
      (typeof value["deliveryTurnId"] !== "string" || value["deliveryTurnId"] === "")) ||
    typeof value["id"] !== "string" ||
    value["id"] === "" ||
    (value["presentation"] !== "queue" && value["presentation"] !== "composer") ||
    typeof value["text"] !== "string"
  ) {
    return undefined;
  }
  return {
    acknowledgedUserMessageIds: value["acknowledgedUserMessageIds"],
    deliveryState: value["deliveryState"],
    ...(typeof value["deliveryTurnId"] === "string"
      ? { deliveryTurnId: value["deliveryTurnId"] }
      : {}),
    files,
    id: value["id"],
    presentation: value["presentation"],
    skills,
    text: value["text"],
  };
}

function readPersistedQueue(
  storage: ComposerDraftStorage | undefined,
  scope: string,
): readonly QueuedComposerPrompt[] {
  try {
    const raw = storage?.getItem(`${COMPOSER_QUEUE_STORAGE_PREFIX}${scope}`);
    if (raw === undefined || raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed["version"] !== 1 || !Array.isArray(parsed["queuedPrompts"])) {
      return [];
    }
    const prompts = parsed["queuedPrompts"].map(parsePersistedQueuedPrompt);
    const validPrompts = prompts.filter(
      (prompt): prompt is QueuedComposerPrompt => prompt !== undefined,
    );
    return validPrompts.length === prompts.length ? validPrompts : [];
  } catch {
    return [];
  }
}

function persistQueue(
  storage: ComposerDraftStorage | undefined,
  scope: string,
  queuedPrompts: readonly QueuedComposerPrompt[],
): void {
  if (storage === undefined) return;
  const key = `${COMPOSER_QUEUE_STORAGE_PREFIX}${scope}`;
  try {
    if (queuedPrompts.length === 0) {
      storage.removeItem(key);
      return;
    }
    // 排队前已上传浏览器附件；持久层只接受可在刷新后继续发送的受管附件。
    if (queuedPrompts.some((prompt) => prompt.files.some((file) => file.source !== "host"))) return;
    storage.setItem(key, JSON.stringify({ queuedPrompts, version: 1 }));
  } catch {
    // 浏览器禁用或耗尽 Storage 时仍保留当前页面内的队列。
  }
}

function resolveComposerDraftStorage(): ComposerDraftStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function createComposerDraftStore(
  storage: ComposerDraftStorage | undefined = resolveComposerDraftStorage(),
): ComposerDraftStore {
  const drafts = new Map<string, ComposerDraft>();
  const read = (scope: string) => {
    const cached = drafts.get(scope);
    if (cached !== undefined) return cached;
    const queuedPrompts = readPersistedQueue(storage, scope);
    if (queuedPrompts.length === 0) return emptyComposerDraft;
    const restoredDraft = { ...emptyComposerDraft, queuedPrompts };
    drafts.set(scope, restoredDraft);
    return restoredDraft;
  };
  const clear = (scope: string) => {
    const draft = drafts.get(scope);
    if (draft !== undefined) {
      revokeDraftPreviews(draft);
      drafts.delete(scope);
    }
    persistQueue(storage, scope, []);
  };
  const update = (scope: string, applyUpdate: (draft: ComposerDraft) => ComposerDraft) => {
    const previousDraft = read(scope);
    const nextDraft = applyUpdate(previousDraft);
    revokeRemovedDraftPreviews(previousDraft, nextDraft);
    if (isEmptyComposerDraft(nextDraft)) {
      drafts.delete(scope);
    } else {
      drafts.set(scope, nextDraft);
    }
    persistQueue(storage, scope, nextDraft.queuedPrompts);
  };
  const dispose = () => {
    drafts.forEach(revokeDraftPreviews);
    drafts.clear();
  };
  return { clear, dispose, read, update };
}

export function ComposerDraftProvider({ children }: Readonly<{ children: ReactNode }>) {
  const storeRef = useRef(createComposerDraftStore());
  const store = storeRef.current;

  useEffect(
    () => () => {
      // Provider 生命周期结束时统一释放仍由草稿或队列持有的附件预览。
      store.dispose();
    },
    [store],
  );

  return <ComposerDraftContext.Provider value={store}>{children}</ComposerDraftContext.Provider>;
}

export function useComposerDraftStore(): ComposerDraftStore {
  const store = useContext(ComposerDraftContext);
  if (store === undefined) {
    throw new Error("useComposerDraftStore must be used inside ComposerDraftProvider");
  }
  return store;
}
