import { Type, type Static } from "@sinclair/typebox";

import { ProjectOpenAppIdSchema } from "./project-files.js";

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

export const AgentCollaborationModeSchema = Type.Literal("plan");
export type AgentCollaborationMode = Readonly<Static<typeof AgentCollaborationModeSchema>>;

const AgentGlobalSettingProperties = {
  commitMessageModel: Type.String({ minLength: 1 }),
  commitMessagePrompt: Type.String({ maxLength: 4_000 }),
  commitMessageReasoningEffort: Type.String({ minLength: 1 }),
  // 文件专用系统关联不能成为 Project 根目录的默认打开方式。
  defaultOpenAppId: Type.Union([
    Type.Exclude(ProjectOpenAppIdSchema, Type.Literal("system-default")),
    Type.Null(),
  ]),
  followUpBehavior: Type.Union([Type.Literal("queue"), Type.Literal("steer")]),
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

const AgentTurnOptionProperties = {
  collaborationMode: Type.Optional(AgentCollaborationModeSchema),
  ...AgentTaskSettingProperties,
};

// Collaboration mode only controls Turn execution and must not enter persisted Task settings.
export const AgentTurnOptionsSchema = Type.Union([
  Type.Object(
    {
      approvalPolicy: AgentApprovalPolicySchema,
      approvalsReviewer: Type.Literal("user"),
      ...AgentTurnOptionProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      approvalPolicy: Type.Literal("on-request"),
      approvalsReviewer: Type.Literal("auto_review"),
      ...AgentTurnOptionProperties,
    },
    { additionalProperties: false },
  ),
]);
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
