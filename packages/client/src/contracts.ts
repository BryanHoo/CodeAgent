import type {
  AgentAttachmentKind,
  AgentEvent,
  PendingRequest,
  ResolvePendingRequestRequest,
  ResyncRequired,
} from "@code-agent/protocol";
import type { Static, TSchema } from "@sinclair/typebox";

export type CodeAgentRequestContext = Readonly<{
  idempotencyKey?: string;
  requestId: string;
  signal?: AbortSignal;
}>;

export type ReadOptions = Readonly<{ signal?: AbortSignal }>;

export type MutationOptions = Readonly<{
  idempotencyKey?: string;
  signal?: AbortSignal;
}>;

export type AgentAttachmentUploadInput = Readonly<{
  content: Blob;
  kind: AgentAttachmentKind;
  name: string;
}>;

export type ListTasksOptions = Readonly<{
  cursor?: string;
  limit?: number;
  pinnedOnly?: true;
}>;

export type PendingRequestResolution<T extends PendingRequest> = Extract<
  ResolvePendingRequestRequest,
  { type: T["type"] }
>["resolution"];

export type CodeAgentOperation<
  TInput = unknown,
  TOutputSchema extends TSchema = TSchema,
> = Readonly<{
  input?: TInput;
  name: string;
  output: TOutputSchema;
}>;

export type CodeAgentOperationOutput<TOperation extends CodeAgentOperation> = Static<
  TOperation["output"]
>;

export type AgentEventConnectionState = "closed" | "connected" | "connecting" | "reconnecting";

export interface SubscribeAgentEventsOptions {
  afterSequence: number;
  onConnectionState?: (state: AgentEventConnectionState) => void;
  onError?: (error: Error) => void;
  onEvent: (event: AgentEvent) => void;
  onResyncRequired: (message: ResyncRequired) => void;
  projectId: string;
  reconnectDelayMs?: number;
  sessionId: string;
}

export type AssetReference = Readonly<{
  attachmentId?: string;
  kind: "project-attachment" | "project-image" | "task-attachment";
  path: string;
  projectId: string;
  taskId?: string;
}>;

export interface CodeAgentTransport {
  cancel(requestId: string): Promise<void>;
  request(operation: CodeAgentOperation, context: CodeAgentRequestContext): Promise<unknown>;
  resolveAssetUrl(reference: AssetReference): string;
  subscribeEvents(options: SubscribeAgentEventsOptions): () => void;
  subscribeUnauthorized?(listener: () => void): () => void;
}
