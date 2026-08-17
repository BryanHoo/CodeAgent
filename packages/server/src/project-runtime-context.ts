import { randomUUID } from "node:crypto";

import type { AgentProvider } from "@code-agent/core";
import type { Project } from "@code-agent/protocol";

import { AgentEventStream, type AgentEventStreamOptions } from "./agent-event-stream.js";
import type { AttachmentStore } from "./attachment-store.js";
import type { ProjectRuntimeContext } from "./routes/context.js";

export function createProjectRuntimeContext(
  options: Readonly<{
    attachmentStore: AttachmentStore;
    eventBufferSize?: number;
    eventProvider: AgentEventStreamOptions["provider"];
    eventSessionId?: string;
    onActivity: () => void;
    onAttachmentReleaseError: (error: unknown) => void;
    project: Project;
    provider: AgentProvider;
  }>,
): ProjectRuntimeContext {
  const eventStream = new AgentEventStream({
    ...(options.eventBufferSize === undefined ? {} : { capacity: options.eventBufferSize }),
    provider: options.eventProvider,
    sessionId: options.eventSessionId ?? randomUUID(),
  });
  const { attachmentStore, onAttachmentReleaseError, project, provider } = options;
  return {
    eventStream,
    project,
    provider,
    transportMetrics: { activeClients: 0, slowClientDisconnects: 0 },
    unsubscribe: provider.subscribeEvents((event) => {
      options.onActivity();
      if (event.type === "turn.completed") {
        // Turn 终态到达后异步释放上传附件，不阻塞事件发布链路。
        void attachmentStore
          .releaseTurn(project.id, event.payload.turn.id)
          .catch(onAttachmentReleaseError);
      }
      eventStream.publish(event);
    }),
  };
}
