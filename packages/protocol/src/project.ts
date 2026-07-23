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

export const AgentTaskSnapshotSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
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
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type AgentCapabilities = Readonly<Static<typeof AgentCapabilitiesSchema>>;
