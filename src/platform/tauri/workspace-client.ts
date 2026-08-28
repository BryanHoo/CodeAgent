import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  AgentAttachmentUploadInput,
  ListFilesystemEntriesOptions,
  MutationOptions,
  ReadOptions,
} from "@/platform/native-client-types.js";
import type {
  AgentAttachmentUploadResponse,
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  CreateProjectBranchRequest,
  CreateProjectWorktreeRequest,
  DeleteProjectFileRequest,
  DeleteProjectFileResponse,
  ProjectFileSearchPage,
  ProjectFileTree,
  ProjectGitCommitFileDiff,
  ProjectGitCommitFileDiffQuery,
  ProjectGitCommitFilesPage,
  ProjectGitCommitFilesQuery,
  ProjectGitHistoryPage,
  ProjectGitHistoryQuery,
  ProjectGitStatus,
  ProjectGitStatusQuery,
  ProjectGitWorktreePage,
  ProjectWorktreeMutationResponse,
  ProjectSourceFile,
  RenameProjectFileRequest,
  RenameProjectFileResponse,
  StopProjectFileSearchResponse,
  SwitchProjectBranchRequest,
  SwitchProjectWorktreeRequest,
  GenerateCommitMessageRequest,
  GenerateCommitMessageResponse,
  HostFileKind,
  HostFileListing,
  OpenAgentTaskAttachmentResponse,
  OpenProjectRequest,
  OpenProjectResponse,
  ProjectOpenCapabilitiesResponse,
} from "@/protocol/index.js";

import { TauriNativeClient } from "./native-client.js";
import { buildNativeAssetUrl } from "../native-asset-url.js";

export class TauriWorkspaceClient extends TauriNativeClient {
  public async cacheProjectImage(
    projectId: string,
    rootPath: string | undefined,
    path: string,
    _options: ReadOptions = {},
  ): Promise<string> {
    const response = await this.call<AgentAttachmentUploadResponse>("cache_project_image", {
      path,
      projectId,
      rootPath: rootPath ?? null,
    });
    return buildNativeAssetUrl(response.attachment.id);
  }

  public async listHostFiles(
    kind: HostFileKind,
    path?: string,
    options: ListFilesystemEntriesOptions = {},
  ): Promise<HostFileListing> {
    return this.call("list_host_files", {
      includeHidden: options.includeHidden === true,
      kind,
      path: path ?? null,
    });
  }

  public async uploadAttachment(
    projectId: string,
    input: AgentAttachmentUploadInput,
    _options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    const bytes = Array.from(new Uint8Array(await input.content.arrayBuffer()));
    return this.call("upload_attachment", {
      bytes,
      kind: input.kind,
      name: input.name,
      projectId,
    });
  }

  public async importHostAttachment(
    projectId: string,
    kind: HostFileKind,
    path: string,
    _options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    return this.call("import_host_attachment", { kind, path, projectId });
  }

  public getTaskAttachmentUrl(
    _projectId: string,
    _taskId: string,
    attachmentId: string,
  ): string {
    return /^(?:blob:|data:|https?:)/u.test(attachmentId)
      ? attachmentId
      : convertFileSrc(attachmentId);
  }

  public async openTaskAttachment(
    projectId: string,
    taskId: string,
    attachmentId: string,
    _options: MutationOptions = {},
  ): Promise<OpenAgentTaskAttachmentResponse> {
    return this.call("open_task_attachment", { attachmentId, projectId, taskId });
  }

  public async getProjectOpenCapabilities(
    projectId: string,
    _options: ReadOptions = {},
  ): Promise<ProjectOpenCapabilitiesResponse> {
    return this.call("get_project_open_capabilities", { projectId });
  }

  public async openProject(
    projectId: string,
    rootPath: string | undefined,
    input: OpenProjectRequest,
    _options: MutationOptions = {},
  ): Promise<OpenProjectResponse> {
    return this.call("open_project", {
      appId: input.appId,
      path: input.path ?? null,
      projectId,
      rootPath: rootPath ?? null,
    });
  }

  public async switchProjectBranch(
    projectId: string,
    rootPath: string,
    input: SwitchProjectBranchRequest,
    _options: MutationOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.call("switch_project_branch", { input, projectId, rootPath });
  }

  public async createProjectBranch(
    projectId: string,
    rootPath: string,
    input: CreateProjectBranchRequest,
    _options: MutationOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.call("create_project_branch", { input, projectId, rootPath });
  }

  public async listProjectWorktrees(
    projectId: string,
    rootPath: string,
    _options: ReadOptions = {},
  ): Promise<ProjectGitWorktreePage> {
    return this.call("list_project_worktrees", { projectId, rootPath });
  }

  public async createProjectWorktree(
    projectId: string,
    rootPath: string,
    input: CreateProjectWorktreeRequest,
    _options: MutationOptions = {},
  ): Promise<ProjectWorktreeMutationResponse> {
    return this.call("create_project_worktree", { input, projectId, rootPath });
  }

  public async switchProjectWorktree(
    projectId: string,
    rootPath: string,
    input: SwitchProjectWorktreeRequest,
    _options: MutationOptions = {},
  ): Promise<ProjectWorktreeMutationResponse> {
    return this.call("switch_project_worktree", { input, projectId, rootPath });
  }

  public async generateCommitMessage(
    projectId: string,
    rootPath: string,
    input: GenerateCommitMessageRequest,
    _options: MutationOptions = {},
  ): Promise<GenerateCommitMessageResponse> {
    return this.call("generate_commit_message", { input, projectId, rootPath });
  }

  public async commitProjectChanges(
    projectId: string,
    rootPath: string,
    input: CommitProjectChangesRequest,
    _options: MutationOptions = {},
  ): Promise<CommitProjectChangesResponse> {
    return this.call("commit_project_changes", { input, projectId, rootPath });
  }

  public async getProjectGitStatus(
    projectId: string,
    input: ProjectGitStatusQuery,
    _options: ReadOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.call("get_project_git_status", {
      input: { ...input, includeDiff: input.includeDiff === true },
      projectId,
    });
  }

  public async getProjectGitHistory(
    projectId: string,
    input: ProjectGitHistoryQuery,
    _options: ReadOptions = {},
  ): Promise<ProjectGitHistoryPage> {
    return this.call("get_project_git_history", { input, projectId });
  }

  public async getProjectGitCommitFiles(
    projectId: string,
    input: ProjectGitCommitFilesQuery,
    _options: ReadOptions = {},
  ): Promise<ProjectGitCommitFilesPage> {
    return this.call("get_project_git_commit_files", { input, projectId });
  }

  public async getProjectGitCommitFileDiff(
    projectId: string,
    input: ProjectGitCommitFileDiffQuery,
    _options: ReadOptions = {},
  ): Promise<ProjectGitCommitFileDiff> {
    return this.call("get_project_git_commit_file_diff", { input, projectId });
  }

  public async listProjectFiles(
    projectId: string,
    rootPath: string,
    directoryPath: string | null,
    _options: ReadOptions = {},
  ): Promise<ProjectFileTree> {
    return this.call("list_project_files", { directoryPath, projectId, rootPath });
  }

  public async searchProjectFiles(
    projectId: string,
    rootPath: string,
    query: string,
    sessionId: string,
    options: ReadOptions = {},
  ): Promise<ProjectFileSearchPage> {
    await this.ensureRuntime();
    options.signal?.throwIfAborted();
    const stopSearch = () => {
      // 直接发送停止命令，避免取消路径再次等待运行时初始化。
      void this.invokeNative("stop_project_file_search", { projectId, rootPath, sessionId }).catch(
        () => undefined,
      );
    };
    options.signal?.addEventListener("abort", stopSearch, { once: true });
    try {
      return await this.call("search_project_files", { projectId, query, rootPath, sessionId });
    } finally {
      options.signal?.removeEventListener("abort", stopSearch);
    }
  }

  public async stopProjectFileSearch(
    projectId: string,
    rootPath: string,
    sessionId: string,
    _options: MutationOptions = {},
  ): Promise<StopProjectFileSearchResponse> {
    return this.call("stop_project_file_search", { projectId, rootPath, sessionId });
  }

  public async renameProjectFile(
    projectId: string,
    rootPath: string,
    input: RenameProjectFileRequest,
    _options: MutationOptions = {},
  ): Promise<RenameProjectFileResponse> {
    return this.call("rename_project_file", { input, projectId, rootPath });
  }

  public async deleteProjectFile(
    projectId: string,
    rootPath: string,
    input: DeleteProjectFileRequest,
    _options: MutationOptions = {},
  ): Promise<DeleteProjectFileResponse> {
    return this.call("delete_project_file", { input, projectId, rootPath });
  }

  public async readProjectSourceFile(
    projectId: string,
    rootPath: string | undefined,
    path: string,
    cursor?: number,
    _options: ReadOptions = {},
  ): Promise<ProjectSourceFile> {
    return this.call("read_project_source_file", {
      cursor: cursor ?? null,
      path,
      projectId,
      rootPath: rootPath ?? null,
    });
  }
}
