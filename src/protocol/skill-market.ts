import { Type, type Static } from "@sinclair/typebox";

export const InstalledSkillSchema = Type.Object(
  {
    description: Type.String(),
    displayName: Type.String(),
    enabled: Type.Boolean(),
    id: Type.String(),
    marketplace: Type.Optional(
      Type.Object(
        {
          installedVersion: Type.String(),
          owner: Type.String(),
          slug: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    name: Type.String(),
    path: Type.String(),
    projectId: Type.Optional(Type.String()),
    projectName: Type.Optional(Type.String()),
    rootPath: Type.Optional(Type.String()),
    scope: Type.String(),
    source: Type.Union([Type.Literal("clawhub"), Type.Literal("local")]),
  },
  { additionalProperties: false },
);
export type InstalledSkill = Readonly<Static<typeof InstalledSkillSchema>>;

export const InstalledSkillPageSchema = Type.Object(
  { data: Type.Array(InstalledSkillSchema), nextCursor: Type.Null() },
  { additionalProperties: false },
);
export type InstalledSkillPage = Readonly<Static<typeof InstalledSkillPageSchema>>;

export const ClawhubSkillSummarySchema = Type.Object(
  {
    canonicalUrl: Type.String(),
    displayName: Type.String(),
    downloads: Type.Integer(),
    id: Type.String(),
    latestVersion: Type.String(),
    owner: Type.String(),
    slug: Type.String(),
    stars: Type.Integer(),
    summary: Type.String(),
    topics: Type.Array(Type.String()),
    updatedAt: Type.Integer(),
    versionCount: Type.Integer(),
  },
  { additionalProperties: false },
);
export type ClawhubSkillSummary = Readonly<Static<typeof ClawhubSkillSummarySchema>>;

export const ClawhubSkillPageSchema = Type.Object(
  {
    items: Type.Array(ClawhubSkillSummarySchema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ClawhubSkillPage = Readonly<Static<typeof ClawhubSkillPageSchema>>;

export const ClawhubSkillVersionSchema = Type.Object(
  { changelog: Type.String(), createdAt: Type.Integer(), version: Type.String() },
  { additionalProperties: false },
);

export const ClawhubSkillDetailSchema = Type.Intersect([
  ClawhubSkillSummarySchema,
  Type.Object(
    {
      changelog: Type.String(),
      hasWarnings: Type.Boolean(),
      readme: Type.String(),
      scanStatus: Type.String(),
      versions: Type.Array(ClawhubSkillVersionSchema),
    },
    { additionalProperties: false },
  ),
]);
export type ClawhubSkillDetail = Readonly<Static<typeof ClawhubSkillDetailSchema>>;

export type SkillInstallScope = "project" | "user";
export type SkillInstallResult = Readonly<{
  path: string;
  status: "current" | "installed" | "updated";
  version: string;
}>;
