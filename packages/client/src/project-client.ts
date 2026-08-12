import {
  AddProjectResponseSchema,
  AgentMcpServerPageSchema,
  AgentProjectDefaultsResponseSchema,
  AgentSkillPageSchema,
  CommitProjectChangesResponseSchema,
  GenerateCommitMessageResponseSchema,
  HostFileListingSchema,
  HostDirectorySelectionResponseSchema,
  HostFileSelectionResponseSchema,
  OpenProjectResponseSchema,
  ProjectDirectoryListingSchema,
  ProjectFileSearchPageSchema,
  ProjectFileTreeSchema,
  ProjectGitCommitFileDiffSchema,
  ProjectGitCommitFilesPageSchema,
  ProjectGitHistoryPageSchema,
  ProjectGitStatusSchema,
  ProjectOpenCapabilitiesResponseSchema,
  ProjectPageSchema,
  ProjectSourceFileSchema,
  ReloadAgentMcpServersResponseSchema,
  RemoveProjectResponseSchema,
  RenameProjectResponseSchema,
  ReorderProjectsResponseSchema,
  type AgentProjectDefaults,
  type CommitProjectChangesRequest,
  type CreateProjectBranchRequest,
  type GenerateCommitMessageRequest,
  type HostFileKind,
  type OpenProjectRequest,
  type ProjectGitCommitFileDiffQuery,
  type ProjectGitCommitFilesQuery,
  type ProjectGitHistoryQuery,
  type ProjectGitStatusQuery,
  type SwitchProjectBranchRequest,
} from "@code-agent/protocol";

import { TransportCodeAgentClient } from "./client.js";
import type { MutationOptions, ReadOptions } from "./contracts.js";

export class ProjectCodeAgentClient extends TransportCodeAgentClient {
  public listSkills(projectId: string, options: ReadOptions = {}) {
    return this.read(
      { input: { projectId }, name: "skills.list", output: AgentSkillPageSchema },
      options,
    );
  }

  public listMcpServers(projectId: string, taskId: string, options: ReadOptions = {}) {
    return this.read(
      { input: { projectId, taskId }, name: "mcp_servers.list", output: AgentMcpServerPageSchema },
      options,
    );
  }

  public retryMcpServers(projectId: string, taskId: string, options: MutationOptions = {}) {
    return this.mutation(
      {
        input: { projectId, taskId },
        name: "mcp_servers.retry",
        output: ReloadAgentMcpServersResponseSchema,
      },
      options,
    );
  }

  public listProjects(options: ReadOptions = {}) {
    return this.read({ name: "projects.list", output: ProjectPageSchema }, options);
  }

  public listProjectDirectories(path?: string, options: ReadOptions = {}) {
    return this.read(
      { input: { path }, name: "project_directories.list", output: ProjectDirectoryListingSchema },
      options,
    );
  }

  public listHostFiles(kind: HostFileKind, path?: string, options: ReadOptions = {}) {
    return this.read(
      { input: { kind, path }, name: "host_files.list", output: HostFileListingSchema },
      options,
    );
  }

  public selectHostDirectory(options: MutationOptions = {}) {
    return this.mutation(
      { name: "host.directory_select", output: HostDirectorySelectionResponseSchema },
      options,
    );
  }

  public selectHostFiles(kind: HostFileKind, options: MutationOptions = {}) {
    return this.mutation(
      { input: { kind }, name: "host.files_select", output: HostFileSelectionResponseSchema },
      options,
    );
  }

  public reorderProjects(projectIds: readonly string[], options: MutationOptions = {}) {
    return this.mutation(
      { input: { projectIds }, name: "projects.reorder", output: ReorderProjectsResponseSchema },
      options,
    );
  }

  public getProjectDefaults(projectId: string, options: ReadOptions = {}) {
    return this.read(
      {
        input: { projectId },
        name: "project_defaults.get",
        output: AgentProjectDefaultsResponseSchema,
      },
      options,
    );
  }

  public updateProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { projectId, settings },
        name: "project_defaults.update",
        output: AgentProjectDefaultsResponseSchema,
      },
      options,
    );
  }

  public addProject(rootPath: string, options: MutationOptions = {}) {
    return this.mutation(
      { input: { rootPath }, name: "projects.add", output: AddProjectResponseSchema },
      options,
    );
  }

  public renameProject(projectId: string, name: string, options: MutationOptions = {}) {
    return this.mutation(
      { input: { name, projectId }, name: "projects.rename", output: RenameProjectResponseSchema },
      options,
    );
  }

  public removeProject(projectId: string, options: MutationOptions = {}) {
    return this.mutation(
      { input: { projectId }, name: "projects.remove", output: RemoveProjectResponseSchema },
      options,
    );
  }

  public getProjectOpenCapabilities(projectId: string, options: ReadOptions = {}) {
    return this.read(
      {
        input: { projectId },
        name: "projects.open_capabilities",
        output: ProjectOpenCapabilitiesResponseSchema,
      },
      options,
    );
  }

  public openProject(
    projectId: string,
    request: OpenProjectRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      { input: { projectId, request }, name: "projects.open", output: OpenProjectResponseSchema },
      options,
    );
  }

  public getProjectGitStatus(
    projectId: string,
    query: ProjectGitStatusQuery = {},
    options: ReadOptions = {},
  ) {
    return this.read(
      { input: { projectId, query }, name: "git.status", output: ProjectGitStatusSchema },
      options,
    );
  }

  public getProjectGitHistory(
    projectId: string,
    query: ProjectGitHistoryQuery = {},
    options: ReadOptions = {},
  ) {
    return this.read(
      { input: { projectId, query }, name: "git.history", output: ProjectGitHistoryPageSchema },
      options,
    );
  }

  public getProjectGitCommitFiles(
    projectId: string,
    query: ProjectGitCommitFilesQuery,
    options: ReadOptions = {},
  ) {
    return this.read(
      {
        input: { projectId, query },
        name: "git.commit_files",
        output: ProjectGitCommitFilesPageSchema,
      },
      options,
    );
  }

  public getProjectGitCommitFileDiff(
    projectId: string,
    query: ProjectGitCommitFileDiffQuery,
    options: ReadOptions = {},
  ) {
    return this.read(
      {
        input: { projectId, query },
        name: "git.commit_diff",
        output: ProjectGitCommitFileDiffSchema,
      },
      options,
    );
  }

  public switchProjectBranch(
    projectId: string,
    request: SwitchProjectBranchRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      { input: { projectId, request }, name: "git.branch_switch", output: ProjectGitStatusSchema },
      options,
    );
  }

  public createProjectBranch(
    projectId: string,
    request: CreateProjectBranchRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      { input: { projectId, request }, name: "git.branch_create", output: ProjectGitStatusSchema },
      options,
    );
  }

  public generateCommitMessage(
    projectId: string,
    request: GenerateCommitMessageRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { projectId, request },
        name: "git.commit_message_generate",
        output: GenerateCommitMessageResponseSchema,
      },
      options,
    );
  }

  public commitProjectChanges(
    projectId: string,
    request: CommitProjectChangesRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { projectId, request },
        name: "git.commit",
        output: CommitProjectChangesResponseSchema,
      },
      options,
    );
  }

  public listProjectFiles(
    projectId: string,
    directoryPath: string | null,
    options: ReadOptions = {},
  ) {
    return this.read(
      { input: { directoryPath, projectId }, name: "files.tree", output: ProjectFileTreeSchema },
      options,
    );
  }

  public searchProjectFiles(projectId: string, query: string, options: ReadOptions = {}) {
    return this.read(
      { input: { projectId, query }, name: "files.search", output: ProjectFileSearchPageSchema },
      options,
    );
  }

  public readProjectSourceFile(
    projectId: string,
    path: string,
    cursor?: number,
    options: ReadOptions = {},
  ) {
    return this.read(
      {
        input: { cursor, path, projectId },
        name: "files.source_read",
        output: ProjectSourceFileSchema,
      },
      options,
    );
  }
}
