import type { AgentAttachment, AgentTask } from "@code-agent/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import type { PromptCommandAction } from "../components/prompt-command.js";
import type { IdempotencyAttempt } from "../composer-state.js";

export function isComposerControllerScopeCurrent(
  activeScope: string,
  requestScope: string,
): boolean {
  return activeScope === requestScope;
}

export function useWorkbenchComposerController(
  routeScope: string,
  onSubmissionStateChange?: (submitting: boolean) => void,
) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const [pendingTaskState, setPendingTaskState] = useState<{
    scope: string;
    task: AgentTask;
  }>();
  const [submittedTurnState, setSubmittedTurnState] = useState<{
    scope: string;
    turnId: string;
  }>();
  const routeScopeRef = useRef(routeScope);
  routeScopeRef.current = routeScope;

  const startTaskAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const startTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const steerTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const interruptAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const autoStartedQueueIds = useRef(new Set<string>());
  const uploadedAttachments = useRef(new Map<string, AgentAttachment>());
  const uploadAttempts = useRef(new Map<string, string>());
  const commandAttempts = useRef(new Map<PromptCommandAction, IdempotencyAttempt>());
  const actionLock = useMemo(() => createAsyncActionLock(), [routeScope]);

  useEffect(() => {
    onSubmissionStateChange?.(isSubmitting);
  }, [isSubmitting, onSubmissionStateChange]);

  useEffect(
    () => () => {
      onSubmissionStateChange?.(false);
    },
    [onSubmissionStateChange],
  );

  const isCurrentScope = useCallback(
    (requestScope: string) => isComposerControllerScopeCurrent(routeScopeRef.current, requestScope),
    [],
  );

  const reset = useCallback((clearTaskState: boolean) => {
    setIsSubmitting(false);
    setMutationError(null);
    if (clearTaskState) {
      setPendingTaskState(undefined);
      setSubmittedTurnState(undefined);
    }
    startTaskAttempt.current = undefined;
    startTurnAttempt.current = undefined;
    steerTurnAttempt.current = undefined;
    interruptAttempt.current = undefined;
    autoStartedQueueIds.current.clear();
    uploadedAttachments.current.clear();
    uploadAttempts.current.clear();
    commandAttempts.current.clear();
  }, []);

  return {
    actionLock,
    autoStartedQueueIds,
    commandAttempts,
    interruptAttempt,
    isCurrentScope,
    isSubmitting,
    mutationError,
    pendingTaskState,
    reset,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    startTaskAttempt,
    startTurnAttempt,
    steerTurnAttempt,
    submittedTurnState,
    uploadAttempts,
    uploadedAttachments,
  } as const;
}
