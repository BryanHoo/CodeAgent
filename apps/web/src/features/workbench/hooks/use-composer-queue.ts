import type { AgentSkill, AgentTaskSnapshot } from "@code-agent/protocol";
import { useEffect, useEffectEvent, type RefObject } from "react";

import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import {
  reconcileAcknowledgedQueuedPrompts,
  restoreQueuedPromptContent,
} from "../composer-queue.js";
import type { QueuedComposerPrompt } from "../composer-draft-context.js";
import type { ComposerSubmissionRequestOptions } from "../components/workbench-composer-submission.js";
import type { PromptSkillContent } from "../components/prompt-skill-editor.js";

type SubmitPrompt = (
  message: Readonly<{ files: readonly PromptInputAttachment[]; text: string }>,
  skills?: readonly AgentSkill[],
  options?: ComposerSubmissionRequestOptions,
) => Promise<boolean>;

export function useComposerQueue({
  activeTaskId,
  activeTurnId,
  autoStartedQueueIds,
  canEdit,
  clearComposerInput,
  connectionState,
  isCurrentScope,
  isSubmitting,
  queuedPrompts,
  replaceAttachments,
  replacePromptContent,
  replaceQueuedPrompts,
  routeScope,
  snapshot,
  submitPrompt,
}: Readonly<{
  activeTaskId: string | undefined;
  activeTurnId: string | undefined;
  autoStartedQueueIds: RefObject<Set<string>>;
  canEdit: boolean;
  clearComposerInput: () => void;
  connectionState: string;
  isCurrentScope: (scope: string) => boolean;
  isSubmitting: boolean;
  queuedPrompts: readonly QueuedComposerPrompt[];
  replaceAttachments: (files: readonly PromptInputAttachment[]) => void;
  replacePromptContent: (content: PromptSkillContent, cursorOffset?: number) => void;
  replaceQueuedPrompts: (prompts: readonly QueuedComposerPrompt[]) => void;
  routeScope: string;
  snapshot: Pick<AgentTaskSnapshot, "turns"> | undefined;
  submitPrompt: SubmitPrompt;
}>) {
  const waitingComposerPrompt = queuedPrompts.find(
    (prompt) =>
      prompt.presentation === "composer" && prompt.deliveryState === "awaiting_acknowledgement",
  );

  useEffect(() => {
    const reconciled = reconcileAcknowledgedQueuedPrompts(queuedPrompts, snapshot);
    if (reconciled.prompts === queuedPrompts) return;
    replaceQueuedPrompts(reconciled.prompts);
    if (reconciled.acknowledgedComposerPrompt) clearComposerInput();
  }, [clearComposerInput, queuedPrompts, replaceQueuedPrompts, snapshot]);

  const submitQueuedPrompt = useEffectEvent(
    (queuedPrompt: QueuedComposerPrompt, queuedScope: string) => {
      void submitPrompt(
        { files: queuedPrompt.files, text: queuedPrompt.text },
        queuedPrompt.skills,
        {
          clearInputOnSuccess: false,
          forceAction: "start",
          queuedPrompt,
          requestTimelineScroll: false,
        },
      ).then((sent) => {
        if (!sent && isCurrentScope(queuedScope)) {
          autoStartedQueueIds.current.delete(queuedPrompt.id);
        }
      });
    },
  );

  useEffect(() => {
    const queuedScope = routeScope;
    const queuedPrompt = queuedPrompts.find((prompt) => prompt.presentation === "queue");
    if (
      queuedPrompt?.deliveryState !== "queued" ||
      activeTurnId !== undefined ||
      activeTaskId === undefined ||
      isSubmitting ||
      connectionState !== "connected" ||
      autoStartedQueueIds.current.has(queuedPrompt.id)
    ) {
      return;
    }
    autoStartedQueueIds.current.add(queuedPrompt.id);
    submitQueuedPrompt(queuedPrompt, queuedScope);
  }, [
    activeTaskId,
    activeTurnId,
    autoStartedQueueIds,
    connectionState,
    isSubmitting,
    queuedPrompts,
    routeScope,
  ]);

  const editQueuedPrompt = (prompt: QueuedComposerPrompt) => {
    if (!canEdit || prompt.deliveryState !== "queued") return;
    replaceQueuedPrompts(queuedPrompts.filter((candidate) => candidate.id !== prompt.id));
    const content = restoreQueuedPromptContent(prompt);
    replacePromptContent(content);
    replaceAttachments(prompt.files);
  };
  const removeQueuedPrompt = (promptId: string) => {
    const prompt = queuedPrompts.find((candidate) => candidate.id === promptId);
    if (prompt?.deliveryState !== "queued") return;
    replaceQueuedPrompts(queuedPrompts.filter((candidate) => candidate.id !== promptId));
  };
  const steerQueuedPrompt = (prompt: QueuedComposerPrompt) => {
    if (prompt.deliveryState !== "queued") return;
    void submitPrompt({ files: prompt.files, text: prompt.text }, prompt.skills, {
      clearInputOnSuccess: false,
      forceAction: "steer",
      queuedPrompt: prompt,
      requestTimelineScroll: false,
    });
  };

  return {
    editQueuedPrompt,
    removeQueuedPrompt,
    steerQueuedPrompt,
    waitingForAcknowledgement: waitingComposerPrompt !== undefined,
  } as const;
}
