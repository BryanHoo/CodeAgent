// 宿主无关 Client 契约只能从此公开入口导出。
export { TransportCodeAgentClient, type CodeAgentRequestOptions } from "./client.js";
export { ProjectCodeAgentClient } from "./project-client.js";
export { CodeAgentClient } from "./task-client.js";
export type {
  AgentAttachmentUploadInput,
  AgentEventConnectionState,
  AssetReference,
  CodeAgentOperation,
  CodeAgentOperationOutput,
  CodeAgentRequestContext,
  CodeAgentTransport,
  ListTasksOptions,
  MutationOptions,
  PendingRequestResolution,
  ReadOptions,
  SubscribeAgentEventsOptions,
} from "./contracts.js";
export {
  CodeAgentError,
  CodeAgentResponseError,
  normalizeCodeAgentError,
  type CodeAgentErrorShape,
} from "./errors.js";
