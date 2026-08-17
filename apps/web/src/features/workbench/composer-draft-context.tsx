import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { AgentSkill } from "@code-agent/protocol";

import type { PromptInputAttachment } from "../../shared/components/agent/prompt-input.js";
import type { PromptSkillContent } from "./components/prompt-skill-editor.js";

type ComposerPrompt = Readonly<{
  files: readonly PromptInputAttachment[];
  id: string;
  skills: readonly AgentSkill[];
  text: string;
}>;

export type QueuedComposerPrompt = ComposerPrompt &
  (
    | Readonly<{ status: "queued" }>
    | Readonly<{
        assistantMessages: readonly Readonly<{ id: string; textLength: number }>[];
        status: "awaiting-response";
        turnId: string;
      }>
  );

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

type ComposerDraftStore = Readonly<{
  clear: (scope: string) => void;
  dispose: () => void;
  read: (scope: string) => ComposerDraft;
  update: (scope: string, update: (draft: ComposerDraft) => ComposerDraft) => void;
}>;

type ComposerQueueStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const COMPOSER_QUEUE_STORAGE_KEY = "code-agent.composer-queues.v1";

const ComposerDraftContext = createContext<ComposerDraftStore | undefined>(undefined);

export function createComposerDraftScope(projectId: string, taskId?: string): string {
  return JSON.stringify([projectId, taskId ?? "draft"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPersistedSkill(value: unknown): value is AgentSkill {
  return (
    isRecord(value) &&
    typeof value["description"] === "string" &&
    typeof value["displayName"] === "string" &&
    value["displayName"].length > 0 &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["name"] === "string" &&
    value["name"].length > 0 &&
    ["admin", "repo", "system", "user"].includes(String(value["scope"]))
  );
}

function isPersistedHostAttachment(value: unknown): value is PromptInputAttachment {
  if (!isRecord(value) || value["source"] !== "host" || !isRecord(value["attachment"])) {
    return false;
  }
  const attachment = value["attachment"];
  return (
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    ["file", "image", "text"].includes(String(value["kind"])) &&
    typeof value["mediaType"] === "string" &&
    typeof value["name"] === "string" &&
    value["name"].length > 0 &&
    typeof value["previewUrl"] === "string" &&
    typeof value["size"] === "number" &&
    Number.isSafeInteger(value["size"]) &&
    value["size"] > 0 &&
    attachment["id"] === value["id"] &&
    attachment["kind"] === value["kind"] &&
    attachment["mediaType"] === value["mediaType"] &&
    attachment["name"] === value["name"] &&
    attachment["size"] === value["size"]
  );
}

function isPersistedQueuedPrompt(value: unknown): value is QueuedComposerPrompt {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["text"] !== "string" ||
    !Array.isArray(value["files"]) ||
    !value["files"].every(isPersistedHostAttachment) ||
    !Array.isArray(value["skills"]) ||
    !value["skills"].every(isPersistedSkill)
  ) {
    return false;
  }
  if (value["status"] === "queued") {
    return true;
  }
  return (
    value["status"] === "awaiting-response" &&
    typeof value["turnId"] === "string" &&
    Array.isArray(value["assistantMessages"]) &&
    value["assistantMessages"].every(
      (message) =>
        isRecord(message) &&
        typeof message["id"] === "string" &&
        typeof message["textLength"] === "number" &&
        Number.isSafeInteger(message["textLength"]) &&
        message["textLength"] >= 0,
    )
  );
}

function readPersistedQueues(
  storage: ComposerQueueStorage | undefined,
): Map<string, ComposerDraft> {
  if (storage === undefined) {
    return new Map();
  }
  try {
    const serialized = storage.getItem(COMPOSER_QUEUE_STORAGE_KEY);
    if (serialized === null) {
      return new Map();
    }
    const persisted = JSON.parse(serialized) as unknown;
    if (!isRecord(persisted) || persisted["version"] !== 1 || !isRecord(persisted["queues"])) {
      try {
        storage.removeItem(COMPOSER_QUEUE_STORAGE_KEY);
      } catch {
        // 禁用的存储按空队列降级。
      }
      return new Map();
    }
    const drafts = new Map<string, ComposerDraft>();
    for (const [scope, prompts] of Object.entries(persisted["queues"])) {
      if (Array.isArray(prompts) && prompts.every(isPersistedQueuedPrompt) && prompts.length > 0) {
        drafts.set(scope, { ...emptyComposerDraft, queuedPrompts: prompts });
      }
    }
    return drafts;
  } catch {
    try {
      storage.removeItem(COMPOSER_QUEUE_STORAGE_KEY);
    } catch {
      // 读取和清理均不可用时仍保留页面内 Store。
    }
    return new Map();
  }
}

function persistQueues(
  storage: ComposerQueueStorage | undefined,
  drafts: Map<string, ComposerDraft>,
) {
  if (storage === undefined) {
    return;
  }
  const queues = Object.fromEntries(
    [...drafts.entries()].flatMap(([scope, draft]) => {
      // 原始 File 无法可靠写入同步 Web Storage；宿主附件已是可恢复的 Server 引用。
      const persistedPrompts = draft.queuedPrompts.filter((prompt) =>
        prompt.files.every((file) => file.source === "host"),
      );
      return persistedPrompts.length === 0 ? [] : [[scope, persistedPrompts]];
    }),
  );
  try {
    if (Object.keys(queues).length === 0) {
      storage.removeItem(COMPOSER_QUEUE_STORAGE_KEY);
    } else {
      storage.setItem(COMPOSER_QUEUE_STORAGE_KEY, JSON.stringify({ queues, version: 1 }));
    }
  } catch {
    // 浏览器禁用或存储空间不足不能破坏当前页面内的队列。
  }
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

export function createComposerDraftStore(storage?: ComposerQueueStorage): ComposerDraftStore {
  const drafts = readPersistedQueues(storage);
  const read = (scope: string) => drafts.get(scope) ?? emptyComposerDraft;
  const clear = (scope: string) => {
    const draft = drafts.get(scope);
    if (draft !== undefined) {
      revokeDraftPreviews(draft);
      drafts.delete(scope);
      persistQueues(storage, drafts);
    }
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
    persistQueues(storage, drafts);
  };
  const dispose = () => {
    drafts.forEach(revokeDraftPreviews);
    drafts.clear();
  };
  return { clear, dispose, read, update };
}

export function ComposerDraftProvider({ children }: Readonly<{ children: ReactNode }>) {
  const storeRef = useRef(
    createComposerDraftStore(typeof window === "undefined" ? undefined : window.sessionStorage),
  );
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
