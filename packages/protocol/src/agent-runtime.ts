import { Type, type Static, type TSchema } from "@sinclair/typebox";

import { AgentTaskSchema, type AgentTask } from "./agent-attachments.js";
import {
  DateTimeSchema,
  NullableDateTimeSchema,
  ProjectSchema,
  type Project,
} from "./project-files.js";
import { AgentSkillSchema, AgentTurnSchema, type AgentSkill } from "./agent-task.js";
import {
  AgentContextUsageSchema,
  AgentModelSchema,
  AgentTaskSettingsSchema,
  type AgentModel,
} from "./project-settings.js";

export const PendingRequestStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("resolved"),
  Type.Literal("expired"),
]);

export const PendingApprovalDecisionSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("allow_for_session"),
  Type.Literal("deny"),
]);

const PendingNetworkAccessSchema = Type.Object(
  {
    host: Type.String({ minLength: 1 }),
    protocol: Type.Union([
      Type.Literal("http"),
      Type.Literal("https"),
      Type.Literal("socks5Tcp"),
      Type.Literal("socks5Udp"),
    ]),
  },
  { additionalProperties: false },
);

const PendingRequestIdentityProperties = {
  createdAt: DateTimeSchema,
  expiresAt: NullableDateTimeSchema,
  itemId: Type.String({ minLength: 1 }),
  projectId: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
  status: PendingRequestStatusSchema,
  taskId: Type.String({ minLength: 1 }),
  turnId: Type.String({ minLength: 1 }),
};

const PendingRequestResolutionIdentityProperties = {
  itemId: Type.String({ minLength: 1 }),
  projectId: Type.String({ minLength: 1 }),
  taskId: Type.String({ minLength: 1 }),
  turnId: Type.String({ minLength: 1 }),
};

export const PendingUserInputOptionSchema = Type.Object(
  {
    description: Type.String(),
    label: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const PendingUserInputQuestionProperties = {
  header: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  isSecret: Type.Boolean(),
  prompt: Type.String({ minLength: 1 }),
};

export const PendingUserInputQuestionSchema = Type.Union([
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Boolean(),
      options: Type.Array(PendingUserInputOptionSchema, { minItems: 1 }),
      type: Type.Literal("choice"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Literal(true),
      options: Type.Array(PendingUserInputOptionSchema, { maxItems: 0 }),
      type: Type.Literal("choice"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Literal(false),
      options: Type.Array(PendingUserInputOptionSchema, { maxItems: 2, minItems: 2 }),
      type: Type.Literal("confirmation"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Boolean(),
      options: Type.Array(PendingUserInputOptionSchema, { maxItems: 0 }),
      type: Type.Literal("short_text"),
    },
    { additionalProperties: false },
  ),
]);

export const CommandApprovalPendingRequestSchema = Type.Object(
  {
    ...PendingRequestIdentityProperties,
    availableDecisions: Type.Array(PendingApprovalDecisionSchema, { minItems: 1 }),
    command: Type.Union([Type.String(), Type.Null()]),
    cwd: Type.Union([Type.String(), Type.Null()]),
    networkAccess: Type.Union([PendingNetworkAccessSchema, Type.Null()]),
    reason: Type.Union([Type.String(), Type.Null()]),
    type: Type.Literal("command_approval"),
  },
  { additionalProperties: false },
);

export const FileChangeApprovalPendingRequestSchema = Type.Object(
  {
    ...PendingRequestIdentityProperties,
    availableDecisions: Type.Array(PendingApprovalDecisionSchema, { minItems: 1 }),
    grantRoot: Type.Union([Type.String(), Type.Null()]),
    reason: Type.Union([Type.String(), Type.Null()]),
    type: Type.Literal("file_change_approval"),
  },
  { additionalProperties: false },
);

export const UserInputPendingRequestSchema = Type.Object(
  {
    ...PendingRequestIdentityProperties,
    questions: Type.Array(PendingUserInputQuestionSchema, { minItems: 1, maxItems: 3 }),
    type: Type.Literal("user_input"),
  },
  { additionalProperties: false },
);

export const PendingRequestSchema = Type.Union([
  CommandApprovalPendingRequestSchema,
  FileChangeApprovalPendingRequestSchema,
  UserInputPendingRequestSchema,
]);

function createPendingRequestStatusSchema<TStatus extends "expired" | "pending" | "resolved">(
  status: TStatus,
) {
  return Type.Union([
    Type.Object(
      { ...CommandApprovalPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...FileChangeApprovalPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...UserInputPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
  ]);
}

export const ActivePendingRequestSchema = createPendingRequestStatusSchema("pending");
export const ResolvedPendingRequestSchema = createPendingRequestStatusSchema("resolved");
export const ExpiredPendingRequestSchema = createPendingRequestStatusSchema("expired");

export type PendingRequest = Readonly<Static<typeof PendingRequestSchema>>;
export type PendingApprovalDecision = Static<typeof PendingApprovalDecisionSchema>;

const ApprovalResolutionSchema = Type.Object(
  { decision: PendingApprovalDecisionSchema },
  { additionalProperties: false },
);
const UserInputResolutionSchema = Type.Object(
  {
    answers: Type.Record(
      Type.String(),
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 1, minItems: 1 }),
    ),
  },
  { additionalProperties: false },
);

export const ResolvePendingRequestRequestSchema = Type.Union([
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: ApprovalResolutionSchema,
      type: Type.Literal("command_approval"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: ApprovalResolutionSchema,
      type: Type.Literal("file_change_approval"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: UserInputResolutionSchema,
      type: Type.Literal("user_input"),
    },
    { additionalProperties: false },
  ),
]);

export type ResolvePendingRequestRequest = Readonly<
  Static<typeof ResolvePendingRequestRequestSchema>
>;

export const ResolvePendingRequestResponseSchema = Type.Object(
  { request: PendingRequestSchema },
  { additionalProperties: false },
);

export type ResolvePendingRequestResponse = Readonly<
  Static<typeof ResolvePendingRequestResponseSchema>
>;

export const AgentTaskSnapshotSchema = Type.Object(
  {
    contextUsage: Type.Union([AgentContextUsageSchema, Type.Null()]),
    id: Type.String({ minLength: 1 }),
    pendingRequests: Type.Array(ActivePendingRequestSchema),
    pinned: Type.Boolean(),
    projectId: Type.String({ minLength: 1 }),
    settings: AgentTaskSettingsSchema,
    status: Type.Union([Type.Literal("idle"), Type.Literal("running"), Type.Literal("failed")]),
    title: Type.String({ minLength: 1 }),
    turns: Type.Array(AgentTurnSchema),
    updatedAt: DateTimeSchema,
  },
  { additionalProperties: false },
);

export type AgentTaskSnapshot = Readonly<Static<typeof AgentTaskSnapshotSchema>>;

export type Page<T> = Readonly<{
  data: readonly T[];
  nextCursor: string | null;
}>;

function createPageSchema<T extends TSchema>(itemSchema: T) {
  return Type.Object(
    {
      data: Type.Array(itemSchema),
      nextCursor: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  );
}

export const ProjectPageSchema = createPageSchema(ProjectSchema);
export type ProjectPage = Page<Project>;

export const ReorderProjectsResponseSchema = ProjectPageSchema;
export type ReorderProjectsResponse = ProjectPage;

export const AgentTaskPageSchema = createPageSchema(AgentTaskSchema);
export type AgentTaskPage = Page<AgentTask>;

export const AgentModelPageSchema = createPageSchema(AgentModelSchema);
export type AgentModelPage = Page<AgentModel>;

export const AgentSkillPageSchema = createPageSchema(AgentSkillSchema);
export type AgentSkillPage = Page<AgentSkill>;

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type HealthResponse = Readonly<Static<typeof HealthResponseSchema>>;

export const BrowserSessionResponseSchema = Type.Object(
  {
    instanceId: Type.String({ minLength: 1 }),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type BrowserSessionResponse = Readonly<Static<typeof BrowserSessionResponseSchema>>;

export const AgentCapabilitiesSchema = Type.Object(
  {
    feedback: Type.Object({ upload: Type.Boolean() }, { additionalProperties: false }),
    provider: Type.String({ minLength: 1 }),
    skills: Type.Object(
      { list: Type.Boolean(), use: Type.Boolean() },
      { additionalProperties: false },
    ),
    tasks: Type.Object(
      {
        fork: Type.Boolean(),
        list: Type.Boolean(),
        read: Type.Boolean(),
        start: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    turns: Type.Object(
      {
        compact: Type.Boolean(),
        interrupt: Type.Boolean(),
        review: Type.Boolean(),
        start: Type.Boolean(),
        steer: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type AgentCapabilities = Readonly<Static<typeof AgentCapabilitiesSchema>>;
