import { Type, type Static } from "@sinclair/typebox";

import { AgentReviewTargetSchema, AgentTaskSchema } from "./agent-attachments.js";
import { AgentMcpServerPageSchema, AgentPromptInputSchema, AgentTurnSchema } from "./agent-task.js";
import { AgentTurnOptionsSchema } from "./project-settings.js";

export const StartAgentTaskRequestSchema = Type.Object({}, { additionalProperties: false });
export type StartAgentTaskRequest = Readonly<Static<typeof StartAgentTaskRequestSchema>>;

export const StartAgentTaskResponseSchema = Type.Object(
  { task: AgentTaskSchema },
  { additionalProperties: false },
);
export type StartAgentTaskResponse = Readonly<Static<typeof StartAgentTaskResponseSchema>>;

export const PinAgentTaskRequestSchema = Type.Object(
  { pinned: Type.Boolean() },
  { additionalProperties: false },
);
export type PinAgentTaskRequest = Readonly<Static<typeof PinAgentTaskRequestSchema>>;

export const PinAgentTaskResponseSchema = Type.Object(
  { task: AgentTaskSchema },
  { additionalProperties: false },
);
export type PinAgentTaskResponse = Readonly<Static<typeof PinAgentTaskResponseSchema>>;

export const RenameAgentTaskRequestSchema = Type.Object(
  { title: Type.String({ maxLength: 200, minLength: 1, pattern: "\\S" }) },
  { additionalProperties: false },
);
export type RenameAgentTaskRequest = Readonly<Static<typeof RenameAgentTaskRequestSchema>>;

export const RenameAgentTaskResponseSchema = Type.Object(
  { task: AgentTaskSchema },
  { additionalProperties: false },
);
export type RenameAgentTaskResponse = Readonly<Static<typeof RenameAgentTaskResponseSchema>>;

export const ArchiveAgentTaskRequestSchema = Type.Object({}, { additionalProperties: false });
export type ArchiveAgentTaskRequest = Readonly<Static<typeof ArchiveAgentTaskRequestSchema>>;

export const ArchiveAgentTaskResponseSchema = Type.Object(
  { status: Type.Literal("archived"), taskId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type ArchiveAgentTaskResponse = Readonly<Static<typeof ArchiveAgentTaskResponseSchema>>;

export const UnsubscribeAgentTaskResponseSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("busy"),
      Type.Literal("notLoaded"),
      Type.Literal("notSubscribed"),
      Type.Literal("unsubscribed"),
    ]),
    taskId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type UnsubscribeAgentTaskResponse = Readonly<
  Static<typeof UnsubscribeAgentTaskResponseSchema>
>;

export const ReviewAgentTaskRequestSchema = Type.Object(
  { target: AgentReviewTargetSchema },
  { additionalProperties: false },
);
export type ReviewAgentTaskRequest = Readonly<Static<typeof ReviewAgentTaskRequestSchema>>;

export const ReviewAgentTaskResponseSchema = Type.Object(
  { taskId: Type.String({ minLength: 1 }), turn: AgentTurnSchema },
  { additionalProperties: false },
);
export type ReviewAgentTaskResponse = Readonly<Static<typeof ReviewAgentTaskResponseSchema>>;

export const CompactAgentTaskRequestSchema = Type.Object({}, { additionalProperties: false });
export type CompactAgentTaskRequest = Readonly<Static<typeof CompactAgentTaskRequestSchema>>;

export const CompactAgentTaskResponseSchema = Type.Object(
  { status: Type.Literal("compacting"), taskId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type CompactAgentTaskResponse = Readonly<Static<typeof CompactAgentTaskResponseSchema>>;

export const ForkAgentTaskRequestSchema = Type.Object({}, { additionalProperties: false });
export type ForkAgentTaskRequest = Readonly<Static<typeof ForkAgentTaskRequestSchema>>;

export const ForkAgentTaskResponseSchema = Type.Object(
  { task: AgentTaskSchema },
  { additionalProperties: false },
);
export type ForkAgentTaskResponse = Readonly<Static<typeof ForkAgentTaskResponseSchema>>;

export const ReloadAgentMcpServersRequestSchema = Type.Object({}, { additionalProperties: false });
export type ReloadAgentMcpServersRequest = Readonly<
  Static<typeof ReloadAgentMcpServersRequestSchema>
>;

export const ReloadAgentMcpServersResponseSchema = AgentMcpServerPageSchema;
export type ReloadAgentMcpServersResponse = Readonly<
  Static<typeof ReloadAgentMcpServersResponseSchema>
>;

export const UploadAgentFeedbackRequestSchema = Type.Object(
  {
    classification: Type.String({ maxLength: 100, minLength: 1 }),
    includeLogs: Type.Boolean(),
    reason: Type.String({ maxLength: 4_000, minLength: 1 }),
  },
  { additionalProperties: false },
);
export type UploadAgentFeedbackRequest = Readonly<Static<typeof UploadAgentFeedbackRequestSchema>>;

export const UploadAgentFeedbackResponseSchema = Type.Object(
  { status: Type.Literal("sent"), taskId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type UploadAgentFeedbackResponse = Readonly<
  Static<typeof UploadAgentFeedbackResponseSchema>
>;

export const StartAgentTurnRequestSchema = Type.Object(
  { input: AgentPromptInputSchema, options: AgentTurnOptionsSchema },
  { additionalProperties: false },
);
export type StartAgentTurnRequest = Readonly<Static<typeof StartAgentTurnRequestSchema>>;

export const StartAgentTurnResponseSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1 }),
    turn: AgentTurnSchema,
  },
  { additionalProperties: false },
);
export type StartAgentTurnResponse = Readonly<Static<typeof StartAgentTurnResponseSchema>>;

export const SteerAgentTurnRequestSchema = Type.Object(
  {
    input: AgentPromptInputSchema,
    taskId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type SteerAgentTurnRequest = Readonly<Static<typeof SteerAgentTurnRequestSchema>>;

export const SteerAgentTurnResponseSchema = Type.Object(
  {
    status: Type.Literal("accepted"),
    taskId: Type.String({ minLength: 1 }),
    turnId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type SteerAgentTurnResponse = Readonly<Static<typeof SteerAgentTurnResponseSchema>>;

export const InterruptAgentTurnRequestSchema = Type.Object(
  { taskId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type InterruptAgentTurnRequest = Readonly<Static<typeof InterruptAgentTurnRequestSchema>>;

export const InterruptAgentTurnResponseSchema = Type.Object(
  {
    status: Type.Literal("interrupting"),
    taskId: Type.String({ minLength: 1 }),
    turnId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type InterruptAgentTurnResponse = Readonly<Static<typeof InterruptAgentTurnResponseSchema>>;

export const AgentMutationErrorCodeSchema = Type.Union([
  Type.Literal("ACCESS_DENIED"),
  Type.Literal("IDEMPOTENCY_KEY_REQUIRED"),
  Type.Literal("IDEMPOTENCY_CONFLICT"),
  Type.Literal("INVALID_REQUEST"),
  Type.Literal("PROJECT_NOT_FOUND"),
  Type.Literal("TASK_NOT_FOUND"),
  Type.Literal("TURN_NOT_FOUND"),
  Type.Literal("TURN_NOT_RUNNING"),
  Type.Literal("ATTACHMENT_NOT_FOUND"),
  Type.Literal("PENDING_REQUEST_NOT_FOUND"),
  Type.Literal("PENDING_REQUEST_EXPIRED"),
  Type.Literal("PENDING_REQUEST_ALREADY_RESOLVED"),
  Type.Literal("PENDING_REQUEST_MISMATCH"),
  Type.Literal("PAIRING_FAILED"),
  Type.Literal("PAIRING_RATE_LIMITED"),
  Type.Literal("GIT_STATUS_CHANGED"),
  Type.Literal("GIT_REPOSITORY_UNAVAILABLE"),
  Type.Literal("GIT_PATH_UNAVAILABLE"),
  Type.Literal("GIT_COMMIT_FAILED"),
  Type.Literal("GIT_BRANCH_ALREADY_ACTIVE"),
  Type.Literal("GIT_BRANCH_NOT_FOUND"),
  Type.Literal("GIT_BRANCH_SWITCH_FAILED"),
  Type.Literal("GIT_MUTATION_IN_PROGRESS"),
  Type.Literal("GIT_REPOSITORY_READ_ONLY"),
  Type.Literal("COMMIT_MESSAGE_GENERATION_FAILED"),
  Type.Literal("UPDATE_NOT_AVAILABLE"),
  Type.Literal("UPDATE_CHECK_FAILED"),
  Type.Literal("UPDATE_INSTALL_FAILED"),
  Type.Literal("PROVIDER_ERROR"),
]);

export const AgentMutationErrorSchema = Type.Object(
  {
    code: AgentMutationErrorCodeSchema,
    message: Type.String({ minLength: 1 }),
    retryable: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AgentMutationError = Readonly<Static<typeof AgentMutationErrorSchema>>;
