import { Type, type Static } from "@sinclair/typebox";

import { ProjectFileReferencePathSchema, ProjectRelativePathSchema } from "./project-files.js";

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
    path: ProjectFileReferencePathSchema,
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ProjectSourceFile = Readonly<Static<typeof ProjectSourceFileSchema>>;
