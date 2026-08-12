import { FormatRegistry, Type, type Static } from "@sinclair/typebox";

if (!FormatRegistry.Has("date-time")) {
  // HTTP 边界统一使用可解析的 ISO 时间，避免各层重复实现时间格式校验。
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}

export const DateTimeSchema = Type.String({ format: "date-time" });
export const NullableDateTimeSchema = Type.Union([DateTimeSchema, Type.Null()]);

export const ProjectRelativePathSchema = Type.String({
  minLength: 1,
  pattern: "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/$).+$",
});

export type ProjectRelativePath = Static<typeof ProjectRelativePathSchema>;

export const ProjectFileSearchQuerySchema = Type.Object(
  { query: Type.String({ maxLength: 256 }) },
  { additionalProperties: false },
);

export type ProjectFileSearchQuery = Readonly<Static<typeof ProjectFileSearchQuerySchema>>;

export const ProjectFileSearchEntrySchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    path: ProjectRelativePathSchema,
  },
  { additionalProperties: false },
);

export type ProjectFileSearchEntry = Readonly<Static<typeof ProjectFileSearchEntrySchema>>;

export const ProjectFileSearchPageSchema = Type.Object(
  { data: Type.Array(ProjectFileSearchEntrySchema, { maxItems: 50 }) },
  { additionalProperties: false },
);

export type ProjectFileSearchPage = Readonly<Static<typeof ProjectFileSearchPageSchema>>;

export const ProjectFileReferencePathSchema = Type.String({
  maxLength: 32_768,
  minLength: 1,
  pattern: "^[^\\u0000\\r\\n]+$",
});

export type ProjectFileReferencePath = Static<typeof ProjectFileReferencePathSchema>;

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

export const ProjectDirectoryPathSchema = Type.String({
  maxLength: 32_768,
  minLength: 1,
  pattern: "^(?!.*[\\u0000\\r\\n])(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\[^\\\\/]+[\\\\/][^\\\\/]+).*$",
});

export type ProjectDirectoryPath = Static<typeof ProjectDirectoryPathSchema>;

export const ProjectDirectoryQuerySchema = Type.Object(
  { path: Type.Optional(ProjectDirectoryPathSchema) },
  { additionalProperties: false },
);

export type ProjectDirectoryQuery = Readonly<Static<typeof ProjectDirectoryQuerySchema>>;

export const ProjectDirectoryEntrySchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    path: ProjectDirectoryPathSchema,
  },
  { additionalProperties: false },
);

export type ProjectDirectoryEntry = Readonly<Static<typeof ProjectDirectoryEntrySchema>>;

export const ProjectDirectoryListingSchema = Type.Object(
  {
    entries: Type.Array(ProjectDirectoryEntrySchema),
    parentPath: Type.Union([ProjectDirectoryPathSchema, Type.Null()]),
    path: ProjectDirectoryPathSchema,
  },
  { additionalProperties: false },
);

export type ProjectDirectoryListing = Readonly<Static<typeof ProjectDirectoryListingSchema>>;

export const HostFileKindSchema = Type.Union([Type.Literal("file"), Type.Literal("image")]);

export type HostFileKind = Static<typeof HostFileKindSchema>;

export const HostFileQuerySchema = Type.Object(
  {
    kind: HostFileKindSchema,
    path: Type.Optional(ProjectDirectoryPathSchema),
  },
  { additionalProperties: false },
);

export type HostFileQuery = Readonly<Static<typeof HostFileQuerySchema>>;

export const HostFileEntrySchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    path: ProjectDirectoryPathSchema,
    type: Type.Union([Type.Literal("directory"), Type.Literal("file")]),
  },
  { additionalProperties: false },
);

export type HostFileEntry = Readonly<Static<typeof HostFileEntrySchema>>;

export const HostFileListingSchema = Type.Object(
  {
    entries: Type.Array(HostFileEntrySchema),
    parentPath: Type.Union([ProjectDirectoryPathSchema, Type.Null()]),
    path: ProjectDirectoryPathSchema,
  },
  { additionalProperties: false },
);

export type HostFileListing = Readonly<Static<typeof HostFileListingSchema>>;

export const HostDirectorySelectionResponseSchema = Type.Object(
  { path: Type.Union([ProjectDirectoryPathSchema, Type.Null()]) },
  { additionalProperties: false },
);

export type HostDirectorySelectionResponse = Readonly<
  Static<typeof HostDirectorySelectionResponseSchema>
>;

export const HostFileSelectionResponseSchema = Type.Object(
  { paths: Type.Array(ProjectDirectoryPathSchema, { maxItems: 20 }) },
  { additionalProperties: false },
);

export type HostFileSelectionResponse = Readonly<Static<typeof HostFileSelectionResponseSchema>>;

export const HostNotificationRequestSchema = Type.Object(
  {
    body: Type.String({ maxLength: 512, minLength: 1 }),
    tag: Type.String({ maxLength: 128, minLength: 1 }),
    title: Type.String({ maxLength: 120, minLength: 1 }),
  },
  { additionalProperties: false },
);

export type HostNotificationRequest = Readonly<Static<typeof HostNotificationRequestSchema>>;

export const HostNotificationResponseSchema = Type.Object(
  { status: Type.Union([Type.Literal("denied"), Type.Literal("shown")]) },
  { additionalProperties: false },
);

export type HostNotificationResponse = Readonly<Static<typeof HostNotificationResponseSchema>>;

export const ImportHostAttachmentRequestSchema = Type.Object(
  { path: ProjectDirectoryPathSchema },
  { additionalProperties: false },
);

export type ImportHostAttachmentRequest = Readonly<
  Static<typeof ImportHostAttachmentRequestSchema>
>;

export const AddProjectRequestSchema = Type.Object(
  { rootPath: ProjectDirectoryPathSchema },
  { additionalProperties: false },
);

export type AddProjectRequest = Readonly<Static<typeof AddProjectRequestSchema>>;

export const AddProjectResponseSchema = Type.Object(
  { project: ProjectSchema },
  { additionalProperties: false },
);

export type AddProjectResponse = Readonly<Static<typeof AddProjectResponseSchema>>;

export const ProjectOpenAppIdSchema = Type.Union([
  Type.Literal("visual-studio-code"),
  Type.Literal("system-default"),
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
  Type.Literal("system-default"),
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
    path: Type.Optional(ProjectFileReferencePathSchema),
  },
  { additionalProperties: false },
);

export type OpenProjectRequest = Readonly<Static<typeof OpenProjectRequestSchema>>;

export const OpenProjectResponseSchema = Type.Object(
  {
    appId: ProjectOpenAppIdSchema,
    path: Type.Optional(ProjectFileReferencePathSchema),
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
