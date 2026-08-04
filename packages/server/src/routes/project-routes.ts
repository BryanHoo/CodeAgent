import { basename } from "node:path";
import {
  AddProjectResponseSchema,
  AgentMcpServerPageSchema,
  CommitProjectChangesRequestSchema,
  CommitProjectChangesResponseSchema,
  GenerateCommitMessageRequestSchema,
  GenerateCommitMessageResponseSchema,
  AgentAttachmentUploadResponseSchema,
  AgentProjectDefaultsResponseSchema,
  AgentProjectDefaultsSchema,
  AgentSkillPageSchema,
  AgentMutationErrorSchema,
  ProjectPageSchema,
  ProjectFileTreeQuerySchema,
  ProjectFileTreeSchema,
  ProjectGitStatusSchema,
  ProjectOpenCapabilitiesResponseSchema,
  ProjectSourceFileSchema,
  OpenProjectRequestSchema,
  OpenProjectResponseSchema,
  RenameProjectRequestSchema,
  RenameProjectResponseSchema,
  ReorderProjectsRequestSchema,
  ReorderProjectsResponseSchema,
  RemoveProjectRequestSchema,
  RemoveProjectResponseSchema,
  StartAgentTaskRequestSchema,
  type AgentAttachmentKind,
  type AgentProjectDefaults,
  type AgentTaskSettings,
  type CommitProjectChangesRequest,
  type GenerateCommitMessageRequest,
  type ProjectFileTreeQuery,
  type OpenProjectRequest,
  type RenameProjectRequest,
  type ReorderProjectsRequest,
  type RemoveProjectRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";
import type { StoredAttachmentUpload } from "../attachment-store.js";
import { GitCommitError } from "../git-commit.js";
import { ProjectOpenAppUnavailableError, ProjectOpenTargetInvalidError } from "../project-open.js";

import { MutationHttpError, type ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectAttachmentParamsSchema,
  ProjectParamsSchema,
  SourceFileQuerySchema,
} from "./schemas.js";

export const registerProjectRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const {
    activeGitMutations,
    assertCommitSelection,
    assertValidProjectDefaults,
    attachmentStore,
    buildCommitMessagePrompt,
    commitProjectChanges,
    generateCommitMessageWithCodex,
    getProjectContext,
    listModels,
    maximumAttachmentBytes,
    multipartEnvelopeBytes,
    projectContexts,
    projectOpenService,
    projectRepository,
    readEffectiveGlobalSettings,
    readEffectiveProjectDefaults,
    readFileTree,
    readImageFile,
    readProjectGitStatus,
    readSourceFile,
    releaseProjectContext,
    runIdempotent,
    selectProjectDirectory,
    settingsRepository,
    toGitCommitHttpError,
  } = context;

  app.get("/v1/projects", { schema: { response: { 200: ProjectPageSchema } } }, async () => ({
    data: await projectRepository.list(),
    nextCursor: null,
  }));

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/open-capabilities",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: ProjectOpenCapabilitiesResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const project = await projectRepository.read(request.params.projectId);
      if (project === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return projectOpenService.getCapabilities();
    },
  );

  app.post<{
    Body: OpenProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/open",
    {
      schema: {
        body: OpenProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: OpenProjectResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["open-project", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const project = await projectRepository.read(request.params.projectId);
          if (project === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          try {
            await projectOpenService.open(project.rootPath, request.body.appId, request.body.path);
          } catch (error) {
            if (error instanceof ProjectOpenAppUnavailableError) {
              throw new MutationHttpError(
                "INVALID_REQUEST",
                "Project open app is unavailable",
                409,
              );
            }
            if (error instanceof ProjectOpenTargetInvalidError) {
              throw new MutationHttpError("INVALID_REQUEST", "Project open target is invalid", 400);
            }
            throw new MutationHttpError("PROVIDER_ERROR", "Project could not be opened", 502, true);
          }
          return request.body;
        },
      ),
  );

  app.put<{
    Body: ReorderProjectsRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects/order",
    {
      schema: {
        body: ReorderProjectsRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: ReorderProjectsResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["reorder-projects"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const projects = await projectRepository.list();
          const storedProjectIds = new Set(projects.map((project) => project.id));
          const containsCompleteProjectSet =
            request.body.projectIds.length === projects.length &&
            request.body.projectIds.every((projectId) => storedProjectIds.has(projectId));
          if (!containsCompleteProjectSet) {
            throw new MutationHttpError(
              "INVALID_REQUEST",
              "Project order must contain every project exactly once",
              409,
            );
          }
          return {
            data: await projectRepository.reorder(request.body.projectIds),
            nextCursor: null,
          };
        },
      ),
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/mcp-servers",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentMcpServerPageSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return context.provider.listMcpServers();
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/skills",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentSkillPageSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return context.provider.listSkills();
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentProjectDefaultsResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      if ((await getProjectContext(request.params.projectId)) === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return { settings: await readEffectiveProjectDefaults(request.params.projectId) };
    },
  );

  app.put<{
    Body: AgentProjectDefaults;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        body: AgentProjectDefaultsSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: AgentProjectDefaultsResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["update-project-defaults", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if ((await getProjectContext(request.params.projectId)) === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          assertValidProjectDefaults(await listModels(), request.body);
          return {
            settings: await settingsRepository.writeProjectDefaults(
              request.params.projectId,
              request.body,
            ),
          };
        },
      ),
  );

  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects",
    {
      schema: {
        body: StartAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: AddProjectResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(["add-project"], request.headers["idempotency-key"], request.body, async () => {
        const selectedPath = await selectProjectDirectory();
        if (selectedPath === undefined) {
          return { project: null };
        }
        const project = await projectRepository.register({
          name: basename(selectedPath),
          rootPath: selectedPath,
        });
        return { project };
      }),
  );

  app.post<{
    Body: RenameProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/rename",
    {
      schema: {
        body: RenameProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: RenameProjectResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["rename-project", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const project = await projectRepository.rename(
            request.params.projectId,
            request.body.name.trim(),
          );
          if (project === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const existingContext = projectContexts.get(project.id);
          if (existingContext !== undefined) {
            projectContexts.set(project.id, { ...existingContext, project });
          }
          return { project };
        },
      ),
  );

  app.post<{
    Body: RemoveProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/remove",
    {
      schema: {
        body: RemoveProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: RemoveProjectResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["remove-project", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (!(await projectRepository.remove(request.params.projectId))) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          await releaseProjectContext(request.params.projectId);
          return { projectId: request.params.projectId, status: "removed" as const };
        },
      ),
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/git/status",
    {
      schema: {
        params: ProjectParamsSchema,
        response: {
          200: ProjectGitStatusSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readProjectGitStatus(context.project.rootPath);
      } catch {
        // Git 和文件系统错误在 HTTP 边界统一收敛，避免向页面泄露本机路径细节。
        return reply.code(500).send({
          code: "GIT_STATUS_UNAVAILABLE",
          message: "Git working tree status is unavailable",
        });
      }
    },
  );

  app.post<{
    Body: GenerateCommitMessageRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/commit-message",
    {
      schema: {
        body: GenerateCommitMessageRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: GenerateCommitMessageResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      return runIdempotent(
        ["generate-commit-message", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const status = await readProjectGitStatus(context.project.rootPath).catch(() => {
            throw new MutationHttpError(
              "GIT_REPOSITORY_UNAVAILABLE",
              "Git repository is unavailable",
              409,
            );
          });
          assertCommitSelection(status, request.body);
          const globalSettings = await readEffectiveGlobalSettings();
          const settings: AgentTaskSettings = {
            approvalPolicy: "never",
            approvalsReviewer: "user",
            model: globalSettings.commitMessageModel,
            reasoningEffort: globalSettings.commitMessageReasoningEffort,
            sandboxMode: "read-only",
          };
          const message = await generateCommitMessageWithCodex(
            context.provider,
            buildCommitMessagePrompt(status, request.body, globalSettings.commitMessagePrompt),
            settings,
          );
          return { message, snapshot: status.snapshot };
        },
      );
    },
  );

  app.post<{
    Body: CommitProjectChangesRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/commits",
    {
      schema: {
        body: CommitProjectChangesRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          201: CommitProjectChangesResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const result = await runIdempotent(
        ["commit-project-changes", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (activeGitMutations.has(request.params.projectId)) {
            throw new MutationHttpError(
              "GIT_MUTATION_IN_PROGRESS",
              "Another Git mutation is already in progress",
              409,
              true,
            );
          }
          activeGitMutations.add(request.params.projectId);
          try {
            return await commitProjectChanges(context.project.rootPath, request.body);
          } catch (error) {
            if (error instanceof GitCommitError) {
              throw toGitCommitHttpError(error);
            }
            throw new MutationHttpError("GIT_COMMIT_FAILED", "Git commit failed", 502);
          } finally {
            activeGitMutations.delete(request.params.projectId);
          }
        },
      );
      return reply.code(201).send(result);
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: ProjectFileTreeQuery }>(
    "/v1/projects/:projectId/files/tree",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectFileTreeQuerySchema,
        response: {
          200: ProjectFileTreeSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readFileTree(context.project.rootPath, request.query.path);
      } catch {
        // 文件系统错误在交付边界收敛，响应不泄露 Project 的本机路径。
        return reply.code(500).send({
          code: "PROJECT_FILE_TREE_UNAVAILABLE",
          message: "Project file tree is unavailable",
        });
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>(
    "/v1/projects/:projectId/files/image",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: SourceFileQuerySchema,
        response: { 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        const image = await readImageFile(context.project.rootPath, request.query.path);
        return await reply
          .header("cache-control", "private, max-age=60")
          .header("x-content-type-options", "nosniff")
          .type(image.mediaType)
          .send(image.content);
      } catch {
        // 路径不可读、文件超限和签名错误统一隐藏，不向页面泄露具体文件系统状态。
        return reply.code(404).send({
          code: "PROJECT_IMAGE_NOT_FOUND",
          message: "Project image is unavailable",
        });
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>(
    "/v1/projects/:projectId/files/source",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: SourceFileQuerySchema,
        response: {
          200: ProjectSourceFileSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readSourceFile(context.project.rootPath, request.query.path);
      } catch {
        // 路径不可读、文件不存在和二进制内容统一隐藏为不可预览。
        return reply.code(404).send({
          code: "SOURCE_FILE_NOT_FOUND",
          message: "Source file is unavailable",
        });
      }
    },
  );

  app.post<{
    Headers: { "idempotency-key": string };
    Params: { kind: AgentAttachmentKind; projectId: string };
  }>(
    "/v1/projects/:projectId/attachments/:kind",
    {
      schema: {
        headers: IdempotencyHeadersSchema,
        params: ProjectAttachmentParamsSchema,
        response: {
          201: AgentAttachmentUploadResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          413: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const maximumBytes = maximumAttachmentBytes(request.params.kind);
      const contentLength = Number(request.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > maximumBytes + multipartEnvelopeBytes) {
        throw new MutationHttpError("INVALID_REQUEST", "Attachment is too large", 413);
      }
      if ((await getProjectContext(request.params.projectId)) === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      if (!request.isMultipart()) {
        throw new MutationHttpError(
          "INVALID_REQUEST",
          "Attachment must use multipart/form-data",
          400,
        );
      }

      let upload: StoredAttachmentUpload | undefined;
      try {
        const part = await request.file({
          limits: { fields: 0, files: 1, fileSize: maximumBytes, parts: 1 },
        });
        if (part?.fieldname !== "attachment") {
          throw new TypeError("Attachment file part is missing");
        }
        upload = await attachmentStore.add(request.params.projectId, {
          content: part.file,
          kind: request.params.kind,
          mediaType: part.mimetype,
          name: part.filename,
        });
        if (part.file.truncated) {
          throw new RangeError("Attachment exceeds the maximum size");
        }
        const currentUpload = upload;
        const attachment = await runIdempotent(
          ["upload-attachment", request.params.projectId],
          request.headers["idempotency-key"],
          {
            contentDigest: upload.contentDigest,
            kind: request.params.kind,
            mediaType: upload.attachment.mediaType,
            name: upload.attachment.name,
            size: upload.attachment.size,
          },
          () => currentUpload.attachment,
        );
        if (attachment.id !== upload.attachment.id) {
          await attachmentStore.discard(upload.attachment.id);
        }
        return await reply.code(201).send({ attachment });
      } catch (error) {
        if (upload !== undefined) {
          await attachmentStore.discard(upload.attachment.id);
        }
        if (
          error instanceof RangeError ||
          error instanceof app.multipartErrors.RequestFileTooLargeError
        ) {
          throw new MutationHttpError("INVALID_REQUEST", "Attachment is too large", 413);
        }
        if (error instanceof TypeError) {
          throw new MutationHttpError("INVALID_REQUEST", "Attachment is invalid", 400);
        }
        throw error;
      }
    },
  );
  done();
};
