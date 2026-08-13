import {
  AddProjectResponseSchema,
  AgentMcpServerPageSchema,
  AgentMutationErrorSchema,
  AgentProjectDefaultsResponseSchema,
  AgentSkillPageSchema,
  CommitProjectChangesResponseSchema,
  type CreateProjectBranchRequest,
  GenerateCommitMessageResponseSchema,
  HostFileListingSchema,
  OpenProjectResponseSchema,
  ProjectDirectoryListingSchema,
  ProjectFileTreeSchema,
  ProjectFileSearchPageSchema,
  ProjectGitHistoryPageSchema,
  ProjectGitCommitFileDiffSchema,
  ProjectGitCommitFilesPageSchema,
  ProjectGitStatusSchema,
  ProjectOpenCapabilitiesResponseSchema,
  ProjectPageSchema,
  ProjectSourceFileSchema,
  RemoveProjectResponseSchema,
  ReloadAgentMcpServersResponseSchema,
  RenameProjectResponseSchema,
  ReorderProjectsResponseSchema,
  type AddProjectResponse,
  type AgentMcpServerPage,
  type AgentProjectDefaults,
  type AgentProjectDefaultsResponse,
  type AgentSkillPage,
  type CommitProjectChangesRequest,
  type CommitProjectChangesResponse,
  type GenerateCommitMessageRequest,
  type GenerateCommitMessageResponse,
  type HostFileKind,
  type HostFileListing,
  type OpenProjectRequest,
  type OpenProjectResponse,
  type ProjectDirectoryListing,
  type ProjectFileTree,
  type ProjectFileSearchPage,
  type ProjectGitHistoryPage,
  type ProjectGitHistoryQuery,
  type ProjectGitCommitFileDiff,
  type ProjectGitCommitFileDiffQuery,
  type ProjectGitCommitFilesPage,
  type ProjectGitCommitFilesQuery,
  type ProjectGitStatus,
  type ProjectGitStatusQuery,
  type ProjectOpenCapabilitiesResponse,
  type ProjectPage,
  type ProjectSourceFile,
  type SwitchProjectBranchRequest,
  type RemoveProjectResponse,
  type RenameProjectResponse,
  type ReloadAgentMcpServersResponse,
  type ReorderProjectsResponse,
} from "@code-agent/protocol";

import {
  CodeAgentTransport,
  appendQuery,
  projectPath,
  taskPath,
  type MutationOptions,
  type ReadOptions,
} from "./http-client-transport.js";

export class ProjectHttpClient extends CodeAgentTransport {
  public async listSkills(projectId: string, options: ReadOptions = {}): Promise<AgentSkillPage> {
    return this.read(`${projectPath(projectId)}/skills`, AgentSkillPageSchema, options);
  }

  public async listMcpServers(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentMcpServerPage> {
    return this.read(
      `${taskPath(projectId, taskId)}/mcp-servers`,
      AgentMcpServerPageSchema,
      options,
      AgentMutationErrorSchema,
    );
  }

  public async retryMcpServers(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<ReloadAgentMcpServersResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/mcp-servers/retry`,
      {},
      ReloadAgentMcpServersResponseSchema,
      options,
    );
  }

  public async listProjects(options: ReadOptions = {}): Promise<ProjectPage> {
    return this.read("/v1/projects", ProjectPageSchema, options);
  }

  public async listProjectDirectories(
    path?: string,
    showHidden = false,
    options: ReadOptions = {},
  ): Promise<ProjectDirectoryListing> {
    return this.read(
      appendQuery("/v1/project-directories", { path, showHidden: showHidden ? "true" : undefined }),
      ProjectDirectoryListingSchema,
      options,
    );
  }

  public async listHostFiles(
    kind: HostFileKind,
    path?: string,
    showHidden = false,
    options: ReadOptions = {},
  ): Promise<HostFileListing> {
    return this.read(
      appendQuery("/v1/host-files", { kind, path, showHidden: showHidden ? "true" : undefined }),
      HostFileListingSchema,
      options,
    );
  }

  public async reorderProjects(
    projectIds: readonly string[],
    options: MutationOptions = {},
  ): Promise<ReorderProjectsResponse> {
    return this.mutation(
      "/v1/projects/order",
      { projectIds },
      ReorderProjectsResponseSchema,
      options,
      "PUT",
    );
  }

  public async getProjectDefaults(
    projectId: string,
    options: ReadOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.read(
      `${projectPath(projectId)}/defaults`,
      AgentProjectDefaultsResponseSchema,
      options,
    );
  }

  public async updateProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
    options: MutationOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.mutation(
      `${projectPath(projectId)}/defaults`,
      settings,
      AgentProjectDefaultsResponseSchema,
      options,
      "PUT",
    );
  }

  public async addProject(
    rootPath: string,
    options: MutationOptions = {},
  ): Promise<AddProjectResponse> {
    return this.mutation("/v1/projects", { rootPath }, AddProjectResponseSchema, options);
  }

  public async renameProject(
    projectId: string,
    name: string,
    options: MutationOptions = {},
  ): Promise<RenameProjectResponse> {
    return this.mutation(
      `${projectPath(projectId)}/rename`,
      { name },
      RenameProjectResponseSchema,
      options,
    );
  }

  public async removeProject(
    projectId: string,
    options: MutationOptions = {},
  ): Promise<RemoveProjectResponse> {
    return this.mutation(
      `${projectPath(projectId)}/remove`,
      {},
      RemoveProjectResponseSchema,
      options,
    );
  }

  public async getProjectOpenCapabilities(
    projectId: string,
    options: ReadOptions = {},
  ): Promise<ProjectOpenCapabilitiesResponse> {
    return this.read(
      `${projectPath(projectId)}/open-capabilities`,
      ProjectOpenCapabilitiesResponseSchema,
      options,
    );
  }

  public async openProject(
    projectId: string,
    request: OpenProjectRequest,
    options: MutationOptions = {},
  ): Promise<OpenProjectResponse> {
    return this.mutation(
      `${projectPath(projectId)}/open`,
      request,
      OpenProjectResponseSchema,
      options,
    );
  }

  public async getProjectGitStatus(
    projectId: string,
    query: ProjectGitStatusQuery = {},
    options: ReadOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.read(
      appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/git/status`, {
        repository: query.repository,
      }),
      ProjectGitStatusSchema,
      options,
    );
  }

  public async getProjectGitHistory(
    projectId: string,
    query: ProjectGitHistoryQuery = {},
    options: ReadOptions = {},
  ): Promise<ProjectGitHistoryPage> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/git/history`, {
        cursor: query.cursor,
        repository: query.repository,
      }),
      ProjectGitHistoryPageSchema,
      options,
    );
  }

  public async getProjectGitCommitFiles(
    projectId: string,
    query: ProjectGitCommitFilesQuery,
    options: ReadOptions = {},
  ): Promise<ProjectGitCommitFilesPage> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/git/commit-files`, {
        cursor: query.cursor,
        repository: query.repository,
        sha: query.sha,
      }),
      ProjectGitCommitFilesPageSchema,
      options,
    );
  }

  public async getProjectGitCommitFileDiff(
    projectId: string,
    query: ProjectGitCommitFileDiffQuery,
    options: ReadOptions = {},
  ): Promise<ProjectGitCommitFileDiff> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/git/commit-diff`, {
        path: query.path,
        repository: query.repository,
        sha: query.sha,
      }),
      ProjectGitCommitFileDiffSchema,
      options,
    );
  }

  public async switchProjectBranch(
    projectId: string,
    request: SwitchProjectBranchRequest,
    options: MutationOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.mutation(
      `${projectPath(projectId)}/git/branch`,
      request,
      ProjectGitStatusSchema,
      options,
    );
  }

  public async createProjectBranch(
    projectId: string,
    request: CreateProjectBranchRequest,
    options: MutationOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.mutation(
      `${projectPath(projectId)}/git/branches`,
      request,
      ProjectGitStatusSchema,
      options,
    );
  }

  public async generateCommitMessage(
    projectId: string,
    request: GenerateCommitMessageRequest,
    options: MutationOptions = {},
  ): Promise<GenerateCommitMessageResponse> {
    return this.mutation(
      `${projectPath(projectId)}/git/commit-message`,
      request,
      GenerateCommitMessageResponseSchema,
      options,
    );
  }

  public async commitProjectChanges(
    projectId: string,
    request: CommitProjectChangesRequest,
    options: MutationOptions = {},
  ): Promise<CommitProjectChangesResponse> {
    return this.mutation(
      `${projectPath(projectId)}/git/commits`,
      request,
      CommitProjectChangesResponseSchema,
      options,
    );
  }

  public async listProjectFiles(
    projectId: string,
    directoryPath: string | null,
    options: ReadOptions = {},
  ): Promise<ProjectFileTree> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/tree`, {
      path: directoryPath ?? undefined,
    });
    return this.read(requestPath, ProjectFileTreeSchema, options);
  }

  public async searchProjectFiles(
    projectId: string,
    query: string,
    options: ReadOptions = {},
  ): Promise<ProjectFileSearchPage> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/search`, {
      query,
    });
    return this.read(requestPath, ProjectFileSearchPageSchema, options);
  }

  public async readProjectSourceFile(
    projectId: string,
    path: string,
    cursor?: number,
    options: ReadOptions = {},
  ): Promise<ProjectSourceFile> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/source`, {
      cursor,
      path,
    });
    return this.read(requestPath, ProjectSourceFileSchema, options);
  }
}
