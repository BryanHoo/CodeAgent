import type { SubscribeAgentEventsOptions } from "@/platform/native-client-types.js";
import type { AgentEvent } from "@/protocol/index.js";

import type { AgentEventSubscription } from "./runtime.js";

type SubscribeNativeEvents = (options: AgentEventSubscription) => () => void;

export function subscribeProjectEvents(
  subscribeNativeEvents: SubscribeNativeEvents,
  taskProjects: ReadonlyMap<string, string>,
  options: SubscribeAgentEventsOptions,
): () => void {
  let active = true;
  let lastSequence = options.afterSequence;
  options.onConnectionState?.("connected");
  const cleanup = subscribeNativeEvents({
    afterSequence: options.afterSequence,
    onEvent: (event: AgentEvent) => {
      if (!active || event.sessionId !== options.sessionId) return;
      if (taskProjects.get(event.taskId) !== options.projectId) return;
      if (event.sequence <= lastSequence) return;
      if (event.sequence !== lastSequence + 1) {
        active = false;
        options.onResyncRequired({
          latestSequence: event.sequence,
          reason: "sequence_gap",
          sessionId: event.sessionId,
          type: "resync.required",
          version: 3,
        });
        options.onConnectionState?.("closed");
        return;
      }
      lastSequence = event.sequence;
      options.onEvent(event);
    },
    onResyncRequired: (message) => {
      if (!active || message.projectId !== options.projectId) return;
      if (message.sessionId !== options.sessionId) return;
      active = false;
      const { projectId: _projectId, ...resync } = message;
      options.onResyncRequired(resync);
      options.onConnectionState?.("closed");
    },
  });
  return () => {
    if (!active) return cleanup();
    active = false;
    cleanup();
    options.onConnectionState?.("closed");
  };
}
