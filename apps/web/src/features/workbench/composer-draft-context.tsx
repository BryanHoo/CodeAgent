import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import type { PromptInputAttachment } from "../../shared/ai-elements/prompt-input.js";
import type { PromptSkillContent } from "./components/prompt-skill-editor.js";

export type ComposerCommandDraftMode = "feedback" | "subtask";

export type ComposerDraft = Readonly<{
  attachments: readonly PromptInputAttachment[];
  commandDraftMode: ComposerCommandDraftMode | null;
  content: PromptSkillContent;
}>;

const emptyComposerDraft: ComposerDraft = {
  attachments: [],
  commandDraftMode: null,
  content: [],
};

type ComposerDraftStore = Readonly<{
  clear: (scope: string) => void;
  read: (scope: string) => ComposerDraft;
  update: (scope: string, update: (draft: ComposerDraft) => ComposerDraft) => void;
}>;

const ComposerDraftContext = createContext<ComposerDraftStore | undefined>(undefined);

export function createComposerDraftScope(projectId: string, taskId?: string): string {
  return JSON.stringify([projectId, taskId ?? "draft"]);
}

function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return (
    draft.content.length === 0 && draft.attachments.length === 0 && draft.commandDraftMode === null
  );
}

function revokeDraftPreviews(draft: ComposerDraft) {
  for (const attachment of draft.attachments) {
    if (attachment.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function revokeRemovedDraftPreviews(previousDraft: ComposerDraft, nextDraft: ComposerDraft) {
  const retainedPreviewUrls = new Set(
    nextDraft.attachments.map((attachment) => attachment.previewUrl),
  );
  for (const attachment of previousDraft.attachments) {
    if (
      !retainedPreviewUrls.has(attachment.previewUrl) &&
      attachment.previewUrl.startsWith("blob:")
    ) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

export function ComposerDraftProvider({ children }: Readonly<{ children: ReactNode }>) {
  const draftsRef = useRef(new Map<string, ComposerDraft>());
  const read = useCallback(
    (scope: string) => draftsRef.current.get(scope) ?? emptyComposerDraft,
    [],
  );
  const clear = useCallback((scope: string) => {
    const draft = draftsRef.current.get(scope);
    if (draft !== undefined) {
      revokeDraftPreviews(draft);
      draftsRef.current.delete(scope);
    }
  }, []);
  const update = useCallback(
    (scope: string, applyUpdate: (draft: ComposerDraft) => ComposerDraft) => {
      const previousDraft = read(scope);
      const nextDraft = applyUpdate(previousDraft);
      revokeRemovedDraftPreviews(previousDraft, nextDraft);
      if (isEmptyComposerDraft(nextDraft)) {
        draftsRef.current.delete(scope);
      } else {
        draftsRef.current.set(scope, nextDraft);
      }
    },
    [read],
  );
  const store = useMemo<ComposerDraftStore>(() => ({ clear, read, update }), [clear, read, update]);

  useEffect(
    () => () => {
      // Provider 生命周期结束时统一释放仍由草稿持有的附件预览。
      draftsRef.current.forEach(revokeDraftPreviews);
      draftsRef.current.clear();
    },
    [],
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
