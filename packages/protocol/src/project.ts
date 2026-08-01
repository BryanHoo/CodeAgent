import { FormatRegistry, Type, type Static, type TSchema } from "@sinclair/typebox";

if (!FormatRegistry.Has("date-time")) {
  // HTTP 边界统一使用可解析的 ISO 时间，避免各层重复实现时间格式校验。
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}

const DateTimeSchema = Type.String({ format: "date-time" });
const NullableDateTimeSchema = Type.Union([DateTimeSchema, Type.Null()]);

export const ProjectRelativePathSchema = Type.String({
  minLength: 1,
  pattern: "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/$).+$",
});

export type ProjectRelativePath = Static<typeof ProjectRelativePathSchema>;

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

export const AddProjectResponseSchema = Type.Object(
  { project: Type.Union([ProjectSchema, Type.Null()]) },
  { additionalProperties: false },
);

export type AddProjectResponse = Readonly<Static<typeof AddProjectResponseSchema>>;

export const ProjectOpenAppIdSchema = Type.Union([
  Type.Literal("visual-studio-code"),
  Type.Literal("zed"),
  Type.Literal("windsurf"),
  Type.Literal("finder"),
  Type.Literal("terminal"),
  Type.Literal("ghostty"),
  Type.Literal("xcode"),
  Type.Literal("android-studio"),
  Type.Literal("file-manager"),
  Type.Literal("gnome-terminal"),
  Type.Literal("konsole"),
  Type.Literal("xfce-terminal"),
  Type.Literal("explorer"),
  Type.Literal("windows-terminal"),
  Type.Literal("command-prompt"),
]);

export type ProjectOpenAppId = Static<typeof ProjectOpenAppIdSchema>;

export const ProjectOpenAppKindSchema = Type.Union([
  Type.Literal("editor"),
  Type.Literal("file-manager"),
  Type.Literal("terminal"),
  Type.Literal("tool"),
]);

export type ProjectOpenAppKind = Static<typeof ProjectOpenAppKindSchema>;

export const ProjectOpenAppSchema = Type.Object(
  {
    id: ProjectOpenAppIdSchema,
    kind: ProjectOpenAppKindSchema,
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ProjectOpenApp = Readonly<Static<typeof ProjectOpenAppSchema>>;

export const ProjectOpenPlatformSchema = Type.Union([
  Type.Literal("darwin"),
  Type.Literal("linux"),
  Type.Literal("win32"),
]);

export type ProjectOpenPlatform = Static<typeof ProjectOpenPlatformSchema>;

export const ProjectOpenCapabilitiesResponseSchema = Type.Object(
  {
    apps: Type.Array(ProjectOpenAppSchema, { uniqueItems: true }),
    platform: ProjectOpenPlatformSchema,
  },
  { additionalProperties: false },
);

export type ProjectOpenCapabilitiesResponse = Readonly<
  Static<typeof ProjectOpenCapabilitiesResponseSchema>
>;

export const OpenProjectRequestSchema = Type.Object(
  {
    appId: ProjectOpenAppIdSchema,
    path: Type.Optional(ProjectRelativePathSchema),
  },
  { additionalProperties: false },
);

export type OpenProjectRequest = Readonly<Static<typeof OpenProjectRequestSchema>>;

export const OpenProjectResponseSchema = Type.Object(
  {
    appId: ProjectOpenAppIdSchema,
    path: Type.Optional(ProjectRelativePathSchema),
  },
  { additionalProperties: false },
);

export type OpenProjectResponse = Readonly<Static<typeof OpenProjectResponseSchema>>;

export const ReorderProjectsRequestSchema = Type.Object(
  {
    projectIds: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export type ReorderProjectsRequest = Readonly<Static<typeof ReorderProjectsRequestSchema>>;

export const RenameProjectRequestSchema = Type.Object(
  { name: Type.String({ maxLength: 200, minLength: 1, pattern: "\\S" }) },
  { additionalProperties: false },
);

export type RenameProjectRequest = Readonly<Static<typeof RenameProjectRequestSchema>>;

export const RenameProjectResponseSchema = Type.Object(
  { project: ProjectSchema },
  { additionalProperties: false },
);

export type RenameProjectResponse = Readonly<Static<typeof RenameProjectResponseSchema>>;

// 移除仅删除 CodeAgent 注册信息，请求体不接受任何磁盘删除选项。
export const RemoveProjectRequestSchema = Type.Object({}, { additionalProperties: false });

export type RemoveProjectRequest = Readonly<Static<typeof RemoveProjectRequestSchema>>;

export const RemoveProjectResponseSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1 }),
    status: Type.Literal("removed"),
  },
  { additionalProperties: false },
);

export type RemoveProjectResponse = Readonly<Static<typeof RemoveProjectResponseSchema>>;

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

const AgentReviewTargetFieldsSchema = Type.Object(
  {
    branch: Type.Optional(Type.String({ minLength: 1 })),
    instructions: Type.Optional(Type.String({ minLength: 1 })),
    sha: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.Union([
      Type.Literal("uncommitted_changes"),
      Type.Literal("base_branch"),
      Type.Literal("commit"),
      Type.Literal("custom"),
    ]),
  },
  { additionalProperties: false },
);

// 分支只声明条件必填字段；字段白名单由前一个 Schema 统一控制，避免 Ajv 删除其他分支字段。
export const AgentReviewTargetSchema = Type.Intersect([
  AgentReviewTargetFieldsSchema,
  Type.Union([
    Type.Object({ type: Type.Literal("uncommitted_changes") }),
    Type.Object({ branch: Type.String({ minLength: 1 }), type: Type.Literal("base_branch") }),
    Type.Object({ sha: Type.String({ minLength: 1 }), type: Type.Literal("commit") }),
    Type.Object({
      instructions: Type.String({ minLength: 1 }),
      type: Type.Literal("custom"),
    }),
  ]),
]);
export type AgentReviewTarget = Readonly<Static<typeof AgentReviewTargetSchema>>;

export const MAX_AGENT_ATTACHMENTS = 4;
export const MAX_AGENT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_DATA_URL_LENGTH =
  Math.ceil((MAX_AGENT_ATTACHMENT_BYTES * 4) / 3) + 64;

export const AgentImageMediaTypeSchema = Type.Union([
  Type.Literal("image/gif"),
  Type.Literal("image/jpeg"),
  Type.Literal("image/png"),
  Type.Literal("image/webp"),
]);

export type AgentImageMediaType = Readonly<Static<typeof AgentImageMediaTypeSchema>>;

export const AgentAttachmentMediaTypeSchema = Type.Union([
  AgentImageMediaTypeSchema,
  Type.Literal("text/plain"),
]);

export type AgentAttachmentMediaType = Readonly<Static<typeof AgentAttachmentMediaTypeSchema>>;

export const AgentMessageSkillSchema = Type.Object(
  { name: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export type AgentMessageSkill = Readonly<Static<typeof AgentMessageSkillSchema>>;

// Snapshot 只保存可授权读取的附件元数据，避免历史二进制随消息缓存复制。
export const AgentMessageAttachmentSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    mediaType: AgentImageMediaTypeSchema,
    name: Type.String({ maxLength: 255, minLength: 1 }),
    size: Type.Integer({ maximum: MAX_AGENT_ATTACHMENT_BYTES, minimum: 1 }),
  },
  { additionalProperties: false },
);

export type AgentMessageAttachment = Readonly<Static<typeof AgentMessageAttachmentSchema>>;

export const AgentMessageItemSchema = Type.Object(
  {
    attachments: Type.Optional(
      Type.Array(AgentMessageAttachmentSchema, { maxItems: MAX_AGENT_ATTACHMENTS }),
    ),
    id: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    skills: Type.Optional(Type.Array(AgentMessageSkillSchema)),
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

export const AgentBackgroundTerminalSchema = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    itemId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentBackgroundTerminal = Readonly<Static<typeof AgentBackgroundTerminalSchema>>;

export const AgentBackgroundTerminalPageSchema = Type.Object(
  { data: Type.Array(AgentBackgroundTerminalSchema) },
  { additionalProperties: false },
);

export type AgentBackgroundTerminalPage = Readonly<
  Static<typeof AgentBackgroundTerminalPageSchema>
>;

export const TerminateAgentBackgroundTerminalResponseSchema = Type.Object(
  {
    status: Type.Literal("terminated"),
    terminalId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type TerminateAgentBackgroundTerminalResponse = Readonly<
  Static<typeof TerminateAgentBackgroundTerminalResponseSchema>
>;

export const AgentFileChangeSchema = Type.Object(
  {
    diff: Type.String(),
    kind: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    // Provider 历史可能保留绝对路径；只有 Project Git API 收紧为相对路径。
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const GitSnapshotSchema = Type.String({ maxLength: 64, minLength: 64, pattern: "^[a-f0-9]{64}$" });
const SelectedGitPathsSchema = Type.Array(ProjectRelativePathSchema, {
  maxItems: 500,
  minItems: 1,
  uniqueItems: true,
});
const CommitMessageSchema = Type.String({ maxLength: 10_000, minLength: 1, pattern: "\\S" });
const ProjectGitFileChangeSchema = Type.Object(
  {
    diff: Type.String(),
    kind: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    path: ProjectRelativePathSchema,
  },
  { additionalProperties: false },
);

export const ProjectGitStatusSchema = Type.Object(
  {
    baseBranches: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    branch: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    repositoryMode: Type.Union([Type.Literal("root"), Type.Literal("children")]),
    snapshot: GitSnapshotSchema,
    staged: Type.Array(ProjectGitFileChangeSchema),
    unstaged: Type.Array(ProjectGitFileChangeSchema),
  },
  { additionalProperties: false },
);

export type ProjectGitStatus = Readonly<Static<typeof ProjectGitStatusSchema>>;

export const GenerateCommitMessageRequestSchema = Type.Object(
  { expectedSnapshot: GitSnapshotSchema, paths: SelectedGitPathsSchema },
  { additionalProperties: false },
);
export type GenerateCommitMessageRequest = Readonly<
  Static<typeof GenerateCommitMessageRequestSchema>
>;

export const GenerateCommitMessageResponseSchema = Type.Object(
  { message: CommitMessageSchema, snapshot: GitSnapshotSchema },
  { additionalProperties: false },
);
export type GenerateCommitMessageResponse = Readonly<
  Static<typeof GenerateCommitMessageResponseSchema>
>;

export const CommitProjectChangesRequestSchema = Type.Object(
  {
    action: Type.Union([Type.Literal("commit"), Type.Literal("commit_and_push")]),
    expectedSnapshot: GitSnapshotSchema,
    message: CommitMessageSchema,
    paths: SelectedGitPathsSchema,
  },
  { additionalProperties: false },
);
export type CommitProjectChangesRequest = Readonly<
  Static<typeof CommitProjectChangesRequestSchema>
>;

export const CommitProjectChangesResponseSchema = Type.Object(
  {
    branch: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    commitSha: Type.String({ maxLength: 64, minLength: 7, pattern: "^[a-f0-9]+$" }),
    message: CommitMessageSchema,
    pushStatus: Type.Union([
      Type.Literal("not_requested"),
      Type.Literal("pushed"),
      Type.Literal("failed"),
      Type.Literal("not_configured"),
    ]),
  },
  { additionalProperties: false },
);
export type CommitProjectChangesResponse = Readonly<
  Static<typeof CommitProjectChangesResponseSchema>
>;

export const ProjectFileTreeEntrySchema = Type.Object(
  {
    path: ProjectRelativePathSchema,
    type: Type.Union([Type.Literal("directory"), Type.Literal("file")]),
  },
  { additionalProperties: false },
);

export type ProjectFileTreeEntry = Readonly<Static<typeof ProjectFileTreeEntrySchema>>;

export const ProjectFileTreeQuerySchema = Type.Object(
  {
    path: Type.Optional(ProjectRelativePathSchema),
  },
  { additionalProperties: false },
);

export type ProjectFileTreeQuery = Readonly<Static<typeof ProjectFileTreeQuerySchema>>;

export const ProjectFileTreeSchema = Type.Object(
  {
    entries: Type.Array(ProjectFileTreeEntrySchema),
    path: Type.Union([ProjectRelativePathSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type ProjectFileTree = Readonly<Static<typeof ProjectFileTreeSchema>>;

export const ProjectSourceFileSchema = Type.Object(
  {
    content: Type.String(),
    path: ProjectRelativePathSchema,
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

const AgentReviewItemTargetSchema = Type.Union([
  Type.Object({ type: Type.Literal("uncommitted_changes") }, { additionalProperties: false }),
  Type.Object(
    { branch: Type.String({ minLength: 1 }), type: Type.Literal("base_branch") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      sha: Type.String({ minLength: 1 }),
      title: Type.Optional(Type.String({ minLength: 1 })),
      type: Type.Literal("commit"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      instructions: Type.String({ minLength: 1 }),
      type: Type.Literal("custom"),
    },
    { additionalProperties: false },
  ),
]);

export const AgentReviewItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    // Fastify 响应序列化器要求判别 Union 直接展开，不能复用请求侧 Intersect Schema。
    target: AgentReviewItemTargetSchema,
    type: Type.Literal("review"),
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
  AgentReviewItemSchema,
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
      pattern: "^data:(image/(gif|jpeg|png|webp)|text/plain);base64,[A-Za-z0-9+/]+={0,2}$",
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

export const AgentSkillScopeSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("repo"),
  Type.Literal("system"),
  Type.Literal("admin"),
]);

export const AgentSkillSchema = Type.Object(
  {
    description: Type.String(),
    displayName: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    scope: AgentSkillScopeSchema,
  },
  { additionalProperties: false },
);

export type AgentSkill = Readonly<Static<typeof AgentSkillSchema>>;

export const AgentSkillReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentSkillReference = Readonly<Static<typeof AgentSkillReferenceSchema>>;

const AgentAttachmentReferenceSchema = Type.Object(
  { id: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

const AgentPromptInputProperties = {
  attachments: Type.Array(AgentAttachmentReferenceSchema, { maxItems: MAX_AGENT_ATTACHMENTS }),
  skills: Type.Array(AgentSkillReferenceSchema),
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
  Type.Object(
    {
      ...AgentPromptInputProperties,
      skills: Type.Array(AgentSkillReferenceSchema, { minItems: 1 }),
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

export const AgentApprovalsReviewerSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("auto_review"),
]);

export type AgentApprovalsReviewer = Readonly<Static<typeof AgentApprovalsReviewerSchema>>;

export const AgentSandboxModeSchema = Type.Union([
  Type.Literal("read-only"),
  Type.Literal("workspace-write"),
  Type.Literal("danger-full-access"),
]);

export type AgentSandboxMode = Readonly<Static<typeof AgentSandboxModeSchema>>;

const AgentTaskSettingProperties = {
  model: Type.String({ minLength: 1 }),
  reasoningEffort: Type.String({ minLength: 1 }),
  sandboxMode: AgentSandboxModeSchema,
};

export const AgentTaskSettingsSchema = Type.Union([
  Type.Object(
    {
      approvalPolicy: AgentApprovalPolicySchema,
      approvalsReviewer: Type.Literal("user"),
      ...AgentTaskSettingProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      approvalPolicy: Type.Literal("on-request"),
      approvalsReviewer: Type.Literal("auto_review"),
      ...AgentTaskSettingProperties,
    },
    { additionalProperties: false },
  ),
]);

export type AgentTaskSettings = Readonly<Static<typeof AgentTaskSettingsSchema>>;

const AgentGlobalSettingProperties = {
  defaultOpenAppId: Type.Union([ProjectOpenAppIdSchema, Type.Null()]),
  ...AgentTaskSettingProperties,
};

export const AgentGlobalSettingsSchema = Type.Union([
  Type.Object(
    {
      approvalPolicy: AgentApprovalPolicySchema,
      approvalsReviewer: Type.Literal("user"),
      ...AgentGlobalSettingProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      approvalPolicy: Type.Literal("on-request"),
      approvalsReviewer: Type.Literal("auto_review"),
      ...AgentGlobalSettingProperties,
    },
    { additionalProperties: false },
  ),
]);

export type AgentGlobalSettings = Readonly<Static<typeof AgentGlobalSettingsSchema>>;

export const AgentGlobalSettingsResponseSchema = Type.Object(
  { settings: AgentGlobalSettingsSchema },
  { additionalProperties: false },
);

export type AgentGlobalSettingsResponse = Readonly<
  Static<typeof AgentGlobalSettingsResponseSchema>
>;

export const AgentProjectDefaultsSchema = Type.Object(
  {
    model: Type.String({ minLength: 1 }),
    reasoningEffort: Type.String({ minLength: 1 }),
    sandboxMode: AgentSandboxModeSchema,
  },
  { additionalProperties: false },
);

export type AgentProjectDefaults = Readonly<Static<typeof AgentProjectDefaultsSchema>>;

export const AgentProjectDefaultsResponseSchema = Type.Object(
  { settings: AgentProjectDefaultsSchema },
  { additionalProperties: false },
);

export type AgentProjectDefaultsResponse = Readonly<
  Static<typeof AgentProjectDefaultsResponseSchema>
>;

export const AgentTaskSettingsResponseSchema = Type.Object(
  { settings: AgentTaskSettingsSchema },
  { additionalProperties: false },
);

export type AgentTaskSettingsResponse = Readonly<Static<typeof AgentTaskSettingsResponseSchema>>;

export const AgentTurnOptionsSchema = AgentTaskSettingsSchema;
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
  Type.Literal("GIT_STATUS_CHANGED"),
  Type.Literal("GIT_REPOSITORY_UNAVAILABLE"),
  Type.Literal("GIT_PATH_UNAVAILABLE"),
  Type.Literal("GIT_COMMIT_FAILED"),
  Type.Literal("GIT_MUTATION_IN_PROGRESS"),
  Type.Literal("COMMIT_MESSAGE_GENERATION_FAILED"),
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
        rollback: Type.Boolean(),
        start: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type AgentCapabilities = Readonly<Static<typeof AgentCapabilitiesSchema>>;
