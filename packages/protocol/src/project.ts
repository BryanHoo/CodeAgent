import { FormatRegistry, Type, type Static, type TSchema } from "@sinclair/typebox";

if (!FormatRegistry.Has("date-time")) {
  // HTTP 边界统一使用可解析的 ISO 时间，避免各层重复实现时间格式校验。
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}

const DateTimeSchema = Type.String({ format: "date-time" });
const NullableDateTimeSchema = Type.Union([DateTimeSchema, Type.Null()]);

export const ProjectSchema = Type.Object(
  {
    createdAt: DateTimeSchema,
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    rootPath: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type Project = Readonly<Static<typeof ProjectSchema>>;

export const AgentTaskSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    pinned: Type.Boolean(),
    projectId: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    updatedAt: DateTimeSchema,
  },
  { additionalProperties: false },
);

export type AgentTask = Readonly<Static<typeof AgentTaskSchema>>;

export const AgentItemStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("declined"),
  Type.Literal("interrupted"),
]);

export type AgentItemStatus = Static<typeof AgentItemStatusSchema>;

export const AgentMessageItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    text: Type.String(),
    type: Type.Literal("message"),
  },
  { additionalProperties: false },
);

export const AgentReasoningItemSchema = Type.Object(
  {
    content: Type.String(),
    id: Type.String({ minLength: 1 }),
    summary: Type.String(),
    type: Type.Literal("reasoning"),
  },
  { additionalProperties: false },
);

export const AgentCommandItemSchema = Type.Object(
  {
    command: Type.String(),
    cwd: Type.String(),
    exitCode: Type.Optional(Type.Integer()),
    id: Type.String({ minLength: 1 }),
    output: Type.Optional(Type.String()),
    outputTruncated: Type.Boolean(),
    status: AgentItemStatusSchema,
    type: Type.Literal("command"),
  },
  { additionalProperties: false },
);

export const AgentFileChangeSchema = Type.Object(
  {
    diff: Type.String(),
    kind: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const ProjectGitStatusSchema = Type.Object(
  {
    staged: Type.Array(AgentFileChangeSchema),
    unstaged: Type.Array(AgentFileChangeSchema),
  },
  { additionalProperties: false },
);

export type ProjectGitStatus = Readonly<Static<typeof ProjectGitStatusSchema>>;

export const ProjectSourceFileSchema = Type.Object(
  {
    content: Type.String(),
    path: Type.String({ minLength: 1, pattern: "^(?![A-Za-z]:[\\\\/])(?!/).+" }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ProjectSourceFile = Readonly<Static<typeof ProjectSourceFileSchema>>;

export const AgentFileChangeItemSchema = Type.Object(
  {
    changes: Type.Array(AgentFileChangeSchema),
    id: Type.String({ minLength: 1 }),
    status: AgentItemStatusSchema,
    type: Type.Literal("file_change"),
  },
  { additionalProperties: false },
);

export const AgentToolItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    input: Type.Optional(Type.Unknown()),
    name: Type.String({ minLength: 1 }),
    output: Type.Optional(Type.Unknown()),
    status: AgentItemStatusSchema,
    type: Type.Literal("tool"),
  },
  { additionalProperties: false },
);

export const AgentPlanItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    text: Type.String(),
    type: Type.Literal("plan"),
  },
  { additionalProperties: false },
);

export const AgentActivityItemSchema = Type.Object(
  {
    detail: Type.Optional(Type.String()),
    id: Type.String({ minLength: 1 }),
    label: Type.String({ minLength: 1 }),
    status: Type.Optional(AgentItemStatusSchema),
    type: Type.Literal("activity"),
  },
  { additionalProperties: false },
);

export const AgentItemSchema = Type.Union([
  AgentMessageItemSchema,
  AgentReasoningItemSchema,
  AgentCommandItemSchema,
  AgentFileChangeItemSchema,
  AgentToolItemSchema,
  AgentPlanItemSchema,
  AgentActivityItemSchema,
]);

export type AgentItem = Readonly<Static<typeof AgentItemSchema>>;

export const AgentTurnStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("interrupted"),
]);

export const AgentTurnSchema = Type.Object(
  {
    completedAt: NullableDateTimeSchema,
    error: Type.Union([Type.String(), Type.Null()]),
    id: Type.String({ minLength: 1 }),
    items: Type.Array(AgentItemSchema),
    startedAt: NullableDateTimeSchema,
    status: AgentTurnStatusSchema,
  },
  { additionalProperties: false },
);

export type AgentTurn = Readonly<Static<typeof AgentTurnSchema>>;

export const MAX_AGENT_ATTACHMENTS = 4;
export const MAX_AGENT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_DATA_URL_LENGTH =
  Math.ceil((MAX_AGENT_ATTACHMENT_BYTES * 4) / 3) + 64;

export const AgentAttachmentMediaTypeSchema = Type.Union([
  Type.Literal("image/gif"),
  Type.Literal("image/jpeg"),
  Type.Literal("image/png"),
  Type.Literal("image/webp"),
]);

export type AgentAttachmentMediaType = Readonly<Static<typeof AgentAttachmentMediaTypeSchema>>;

export const AgentAttachmentSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    mediaType: AgentAttachmentMediaTypeSchema,
    name: Type.String({ maxLength: 255, minLength: 1 }),
    size: Type.Integer({ maximum: MAX_AGENT_ATTACHMENT_BYTES, minimum: 1 }),
  },
  { additionalProperties: false },
);

export type AgentAttachment = Readonly<Static<typeof AgentAttachmentSchema>>;

export const AgentAttachmentUploadRequestSchema = Type.Object(
  {
    dataUrl: Type.String({
      maxLength: MAX_AGENT_ATTACHMENT_DATA_URL_LENGTH,
      pattern: "^data:image/(gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$",
    }),
    name: Type.String({ maxLength: 255, minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentAttachmentUploadRequest = Readonly<
  Static<typeof AgentAttachmentUploadRequestSchema>
>;

export const AgentAttachmentUploadResponseSchema = Type.Object(
  { attachment: AgentAttachmentSchema },
  { additionalProperties: false },
);

export type AgentAttachmentUploadResponse = Readonly<
  Static<typeof AgentAttachmentUploadResponseSchema>
>;

const AgentAttachmentReferenceSchema = Type.Object(
  { id: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

const AgentPromptInputProperties = {
  attachments: Type.Array(AgentAttachmentReferenceSchema, { maxItems: MAX_AGENT_ATTACHMENTS }),
  text: Type.String({ maxLength: 100_000 }),
  type: Type.Literal("prompt"),
};

export const AgentPromptInputSchema = Type.Union([
  Type.Object(
    {
      ...AgentPromptInputProperties,
      text: Type.String({ maxLength: 100_000, minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...AgentPromptInputProperties,
      attachments: Type.Array(AgentAttachmentReferenceSchema, {
        maxItems: MAX_AGENT_ATTACHMENTS,
        minItems: 1,
      }),
    },
    { additionalProperties: false },
  ),
]);

export type AgentPromptInput = Readonly<Static<typeof AgentPromptInputSchema>>;

export const AgentApprovalPolicySchema = Type.Union([
  Type.Literal("untrusted"),
  Type.Literal("on-request"),
  Type.Literal("never"),
]);

export type AgentApprovalPolicy = Readonly<Static<typeof AgentApprovalPolicySchema>>;

export const AgentTurnOptionsSchema = Type.Object(
  {
    approvalPolicy: AgentApprovalPolicySchema,
    model: Type.String({ minLength: 1 }),
    reasoningEffort: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentTurnOptions = Readonly<Static<typeof AgentTurnOptionsSchema>>;

export const AgentReasoningEffortOptionSchema = Type.Object(
  {
    description: Type.String(),
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentReasoningEffortOption = Readonly<Static<typeof AgentReasoningEffortOptionSchema>>;

export const AgentModelSchema = Type.Object(
  {
    defaultReasoningEffort: Type.String({ minLength: 1 }),
    description: Type.String(),
    displayName: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    isDefault: Type.Boolean(),
    supportedReasoningEfforts: Type.Array(AgentReasoningEffortOptionSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type AgentModel = Readonly<Static<typeof AgentModelSchema>>;

export const AgentContextUsageSchema = Type.Object(
  {
    contextWindow: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    usedTokens: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AgentContextUsage = Readonly<Static<typeof AgentContextUsageSchema>>;

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

export const StartAgentTaskRequestSchema = Type.Object({}, { additionalProperties: false });
export type StartAgentTaskRequest = Readonly<Static<typeof StartAgentTaskRequestSchema>>;

export const StartAgentTaskResponseSchema = Type.Object(
  { task: AgentTaskSchema },
  { additionalProperties: false },
);
export type StartAgentTaskResponse = Readonly<Static<typeof StartAgentTaskResponseSchema>>;

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

export const RollbackAgentTurnRequestSchema = Type.Object(
  { taskId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type RollbackAgentTurnRequest = Readonly<Static<typeof RollbackAgentTurnRequestSchema>>;

export const RollbackAgentTurnResponseSchema = Type.Object(
  {
    restoredFiles: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    status: Type.Literal("rolled_back"),
    taskId: Type.String({ minLength: 1 }),
    turnId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type RollbackAgentTurnResponse = Readonly<Static<typeof RollbackAgentTurnResponseSchema>>;

export const AgentMutationErrorCodeSchema = Type.Union([
  Type.Literal("IDEMPOTENCY_KEY_REQUIRED"),
  Type.Literal("IDEMPOTENCY_CONFLICT"),
  Type.Literal("INVALID_REQUEST"),
  Type.Literal("PROJECT_NOT_FOUND"),
  Type.Literal("TASK_NOT_FOUND"),
  Type.Literal("TURN_NOT_FOUND"),
  Type.Literal("TURN_NOT_RUNNING"),
  Type.Literal("TURN_NOT_ROLLBACKABLE"),
  Type.Literal("FILE_ROLLBACK_CONFLICT"),
  Type.Literal("ATTACHMENT_NOT_FOUND"),
  Type.Literal("PENDING_REQUEST_NOT_FOUND"),
  Type.Literal("PENDING_REQUEST_EXPIRED"),
  Type.Literal("PENDING_REQUEST_ALREADY_RESOLVED"),
  Type.Literal("PENDING_REQUEST_MISMATCH"),
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

export const AgentTaskSnapshotSchema = Type.Object(
  {
    contextUsage: Type.Union([AgentContextUsageSchema, Type.Null()]),
    id: Type.String({ minLength: 1 }),
    pendingRequests: Type.Array(ActivePendingRequestSchema),
    pinned: Type.Boolean(),
    projectId: Type.String({ minLength: 1 }),
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

export const AgentTaskPageSchema = createPageSchema(AgentTaskSchema);
export type AgentTaskPage = Page<AgentTask>;

export const AgentModelPageSchema = createPageSchema(AgentModelSchema);
export type AgentModelPage = Page<AgentModel>;

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type HealthResponse = Readonly<Static<typeof HealthResponseSchema>>;

export const AgentCapabilitiesSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    tasks: Type.Object(
      {
        list: Type.Boolean(),
        read: Type.Boolean(),
        start: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    turns: Type.Object(
      {
        interrupt: Type.Boolean(),
        rollback: Type.Boolean(),
        start: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type AgentCapabilities = Readonly<Static<typeof AgentCapabilitiesSchema>>;
