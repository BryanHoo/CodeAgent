import type { AgentSkill } from "@code-agent/protocol";
import { useEffect, useEffectEvent } from "react";

import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { TaskStoreState } from "../../conversation/runtime/task-store.js";
import type { QueuedComposerPrompt } from "../composer-draft-context.js";
import {
  hasQueuedPromptReceivedAssistantResponse,
  getTaskStoreAssistantMessageCheckpoints,
  hasQueuedPromptReceivedAssistantCheckpoints,
  resolveQueuedPromptEdit,
} from "../composer-queue-state.js";
import {
  createPromptSkillContentFromSubmission,
  serializePromptSkillContent,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "../components/prompt-skill-editor.js";

type SubmitPrompt = (
  message: Readonly<{ files: readonly PromptInputAttachment[]; text: string }>,
  skills?: readonly AgentSkill[],
  options?: Readonly<{
    clearInputOnSuccess?: boolean;
    forceAction?: "start" | "steer";
    queuedPromptId?: string;
    requestTimelineScroll?: boolean;
  }>,
) => Promise<boolean>;

type ComposerQueueOptions = Readonly<{
  activeTaskId: string | undefined;
  activeTurnId: string | undefined;
  autoStartedQueueIds: { current: Set<string> };
  connectionState: TaskRuntimeView["connectionState"];
  handleAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  isCurrentScope: (scope: string) => boolean;
  isSubmitting: boolean;
  queuedPrompts: readonly QueuedComposerPrompt[];
  replacePromptContent: (content: PromptSkillContent, cursorOffset?: number) => void;
  replaceQueuedPrompts: (prompts: readonly QueuedComposerPrompt[]) => void;
  routeScope: string;
  runtime: TaskRuntimeView | undefined;
  skillEditorRef: { current: PromptSkillEditorHandle | null };
  submitPrompt: SubmitPrompt;
}>;

export function useComposerQueue({
  activeTaskId,
  activeTurnId,
  autoStartedQueueIds,
  connectionState,
  handleAttachmentsChange,
  isCurrentScope,
  isSubmitting,
  queuedPrompts,
  replacePromptContent,
  replaceQueuedPrompts,
  routeScope,
  runtime,
  skillEditorRef,
  submitPrompt,
}: ComposerQueueOptions) {
  const dismissRespondedSteers = useEffectEvent(() => {
    const retained = queuedPrompts.filter(
      (prompt) => !hasQueuedPromptReceivedAssistantResponse(prompt, runtime?.snapshot),
    );
    if (retained.length !== queuedPrompts.length) {
      replaceQueuedPrompts(retained);
    }
  });

  useEffect(() => {
    dismissRespondedSteers();
  }, [runtime?.snapshot]);

  const dismissRespondedSteersFromStore = useEffectEvent((state: TaskStoreState) => {
    const retained = queuedPrompts.filter(
      (prompt) =>
        prompt.status !== "awaiting-response" ||
        !hasQueuedPromptReceivedAssistantCheckpoints(
          prompt,
          getTaskStoreAssistantMessageCheckpoints(state, prompt.turnId),
        ),
    );
    if (retained.length !== queuedPrompts.length) {
      replaceQueuedPrompts(retained);
    }
  });

  useEffect(() => {
    const store = runtime?.store;
    if (store === undefined) {
      return undefined;
    }
    return store.subscribe((state) => {
      dismissRespondedSteersFromStore(state);
    });
  }, [runtime?.store]);

  const submitQueuedPrompt = useEffectEvent(
    (queuedPrompt: QueuedComposerPrompt, queuedScope: string) => {
      void submitPrompt(
        { files: queuedPrompt.files, text: queuedPrompt.text },
        queuedPrompt.skills,
        {
          clearInputOnSuccess: false,
          forceAction: "start",
          requestTimelineScroll: false,
        },
      ).then((sent) => {
        if (sent && isCurrentScope(queuedScope)) {
          replaceQueuedPrompts(queuedPrompts.filter((prompt) => prompt.id !== queuedPrompt.id));
        }
      });
    },
  );

  useEffect(() => {
    const queuedPrompt = queuedPrompts[0];
    if (
      queuedPrompt?.status !== "queued" ||
      activeTurnId !== undefined ||
      activeTaskId === undefined ||
      isSubmitting ||
      connectionState !== "connected" ||
      autoStartedQueueIds.current.has(queuedPrompt.id)
    ) {
      return;
    }
    autoStartedQueueIds.current.add(queuedPrompt.id);
    submitQueuedPrompt(queuedPrompt, routeScope);
  }, [
    activeTaskId,
    activeTurnId,
    autoStartedQueueIds,
    connectionState,
    isSubmitting,
    queuedPrompts,
    routeScope,
  ]);

  const removeQueuedPrompt = (queuedPromptId: string) => {
    const prompt = queuedPrompts.find((candidate) => candidate.id === queuedPromptId);
    if (prompt?.status === "queued") {
      replaceQueuedPrompts(queuedPrompts.filter((candidate) => candidate.id !== queuedPromptId));
    }
  };

  const editQueuedPrompt = (queuedPrompt: QueuedComposerPrompt) => {
    const editablePrompt = resolveQueuedPromptEdit(queuedPrompt);
    if (editablePrompt === undefined) {
      return;
    }
    const content = createPromptSkillContentFromSubmission(
      editablePrompt.text,
      editablePrompt.skills,
    );
    removeQueuedPrompt(queuedPrompt.id);
    replacePromptContent(content, serializePromptSkillContent(content).length);
    handleAttachmentsChange(editablePrompt.files);
    requestAnimationFrame(() => {
      skillEditorRef.current?.focus(serializePromptSkillContent(content).length);
    });
  };

  const steerQueuedPrompt = async (queuedPrompt: QueuedComposerPrompt) => {
    if (queuedPrompt.status !== "queued") {
      return;
    }
    await submitPrompt(
      { files: queuedPrompt.files, text: queuedPrompt.text },
      queuedPrompt.skills,
      {
        clearInputOnSuccess: false,
        forceAction: "steer",
        queuedPromptId: queuedPrompt.id,
        requestTimelineScroll: false,
      },
    );
  };

  return { editQueuedPrompt, removeQueuedPrompt, steerQueuedPrompt } as const;
}
