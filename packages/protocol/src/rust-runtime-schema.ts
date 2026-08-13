import { Type, type Static, type TSchema } from "@sinclair/typebox";

import {
  AgentMutationErrorCodeSchema,
  ReviewAgentTaskRequestSchema,
  StartAgentTurnRequestSchema,
  SteerAgentTurnRequestSchema,
} from "./agent-actions.js";
import { AgentBackgroundTerminalPageSchema, AgentTaskSchema } from "./agent-attachments.js";
import {
  AgentEventSchema,
  AgentTaskSnapshotResponseSchema,
  ConnectionReadySchema,
  EventCheckpointSchema,
  EventStreamMessageSchema,
  ResyncRequiredSchema,
} from "./agent-event.js";
import {
  AgentCapabilitiesSchema,
  AgentModelPageSchema,
  AgentSkillPageSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotSchema,
  PendingRequestSchema,
  ResolvePendingRequestRequestSchema,
} from "./agent-runtime.js";
import { AgentAttachmentSchema, AgentMcpServerPageSchema, AgentTurnSchema } from "./agent-task.js";
import {
  AgentProviderConnectionMutationResponseSchema,
  AgentProviderConnectionRecordSchema,
  AgentProviderConnectionStatusSchema,
  CancelProviderLoginRequestSchema,
  ConfigureCustomProviderRequestSchema,
  ConfigureCustomProviderResponseSchema,
  StartOfficialProviderLoginResponseSchema,
} from "./provider-connection.js";
import { ProjectSchema } from "./project-files.js";
import {
  GenerateCommitMessageRequestSchema,
  GenerateCommitMessageResponseSchema,
} from "./project-git.js";
import {
  AgentGlobalSettingsSchema,
  AgentProjectDefaultsSchema,
  AgentTaskSettingsSchema,
} from "./project-settings.js";

export const RUST_RUNTIME_SCHEMA_ID = "https://codeagent.dev/schemas/runtime/v1";

export const ProjectIdSchema = Type.String({ minLength: 1 });
export type ProjectId = Readonly<Static<typeof ProjectIdSchema>>;

export const TaskIdSchema = Type.String({ minLength: 1 });
export type TaskId = Readonly<Static<typeof TaskIdSchema>>;

export const CodeAgentErrorCodeSchema = Type.Union([
  Type.Literal("cancelled"),
  Type.Literal("capacity_exceeded"),
  Type.Literal("conflict"),
  Type.Literal("internal"),
  Type.Literal("invalid_input"),
  Type.Literal("not_found"),
  Type.Literal("provider_failure"),
  Type.Literal("shutting_down"),
  Type.Literal("timeout"),
]);

export const CodeAgentErrorSchema = Type.Object(
  {
    code: CodeAgentErrorCodeSchema,
    correlationId: Type.Optional(Type.String({ minLength: 1 })),
    message: Type.String({ minLength: 1 }),
    mutationCode: Type.Optional(AgentMutationErrorCodeSchema),
  },
  { additionalProperties: false },
);
export type CodeAgentError = Readonly<Static<typeof CodeAgentErrorSchema>>;

const providerTransportFields = [
  "provider",
  "sequence",
  "sessionId",
  "timestamp",
  "version",
] as const;

// Provider 只发布领域事件，传输信封由 Runtime 在进入事件流时统一补齐。
export const AgentProviderEventSchema = Type.Omit(AgentEventSchema, providerTransportFields, {
  $id: "AgentProviderEvent",
});
export type AgentProviderEvent = Readonly<Static<typeof AgentProviderEventSchema>>;

export const RustRuntimeProtocolSchema = Type.Object(
  {
    agentTaskSettings: AgentTaskSettingsSchema,
    capabilities: AgentCapabilitiesSchema,
    error: CodeAgentErrorSchema,
    projectId: ProjectIdSchema,
    providerEvent: AgentProviderEventSchema,
    taskId: TaskIdSchema,
  },
  { additionalProperties: false, title: "RustRuntimeProtocol" },
);

export interface RustRuntimeSchemaDocument extends Record<string, unknown> {
  readonly $defs: Readonly<Record<string, TSchema>>;
  readonly $id: string;
  readonly $schema: string;
}

function normalizeRustUnion(value: unknown, path: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeRustUnion(entry, [...path, String(index)]));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const nextPath = [...path, key];
      const promptInput =
        key === "anyOf" &&
        path.length === 3 &&
        path[1] === "properties" &&
        path[2] === "input" &&
        (path[0] === "StartAgentTurnRequest" || path[0] === "SteerAgentTurnRequest");
      return [
        promptInput ? key : key === "anyOf" ? "oneOf" : key,
        normalizeRustUnion(entry, nextPath),
      ];
    }),
  );
}

export function createRustRuntimeSchemaDocument(): RustRuntimeSchemaDocument {
  const definitions = {
    AgentCapabilities: AgentCapabilitiesSchema,
    AgentAttachment: AgentAttachmentSchema,
    AgentBackgroundTerminalPage: AgentBackgroundTerminalPageSchema,
    AgentGlobalSettings: AgentGlobalSettingsSchema,
    AgentMcpServerPage: AgentMcpServerPageSchema,
    AgentModelPage: AgentModelPageSchema,
    AgentProjectDefaults: AgentProjectDefaultsSchema,
    AgentProviderConnectionMutationResponse: AgentProviderConnectionMutationResponseSchema,
    AgentProviderConnectionRecord: AgentProviderConnectionRecordSchema,
    AgentProviderConnectionStatus: AgentProviderConnectionStatusSchema,
    AgentProviderEvent: AgentProviderEventSchema,
    AgentSkillPage: AgentSkillPageSchema,
    AgentTask: AgentTaskSchema,
    AgentTaskPage: AgentTaskPageSchema,
    AgentTaskSettings: AgentTaskSettingsSchema,
    AgentTaskSnapshot: AgentTaskSnapshotSchema,
    AgentTaskSnapshotResponse: AgentTaskSnapshotResponseSchema,
    AgentTurn: AgentTurnSchema,
    CancelProviderLoginRequest: CancelProviderLoginRequestSchema,
    CodeAgentError: CodeAgentErrorSchema,
    ConfigureCustomProviderRequest: ConfigureCustomProviderRequestSchema,
    ConfigureCustomProviderResponse: ConfigureCustomProviderResponseSchema,
    ConnectionReady: ConnectionReadySchema,
    EventCheckpoint: EventCheckpointSchema,
    EventStreamMessage: EventStreamMessageSchema,
    GenerateCommitMessageRequest: GenerateCommitMessageRequestSchema,
    GenerateCommitMessageResponse: GenerateCommitMessageResponseSchema,
    PendingRequest: PendingRequestSchema,
    Project: ProjectSchema,
    ResolvePendingRequestRequest: ResolvePendingRequestRequestSchema,
    ResyncRequired: ResyncRequiredSchema,
    ReviewAgentTaskRequest: ReviewAgentTaskRequestSchema,
    StartAgentTurnRequest: StartAgentTurnRequestSchema,
    StartOfficialProviderLoginResponse: StartOfficialProviderLoginResponseSchema,
    SteerAgentTurnRequest: SteerAgentTurnRequestSchema,
    TaskId: TaskIdSchema,
  } satisfies Record<string, TSchema>;

  return {
    $defs: normalizeRustUnion(
      Object.fromEntries(
        Object.entries(definitions).toSorted(([left], [right]) => left.localeCompare(right)),
      ),
    ) as Readonly<Record<string, TSchema>>,
    $id: RUST_RUNTIME_SCHEMA_ID,
    $schema: "https://json-schema.org/draft/2020-12/schema",
  };
}
