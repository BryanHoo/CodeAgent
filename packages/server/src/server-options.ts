import type {
  AgentRuntimeProvider,
  AgentProviderConnectionRepository,
  AgentSettingsRepository,
  ProjectRepository,
} from "@code-agent/core";
import type {
  AppInfoResponse,
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  CreateProjectBranchRequest,
  HostFileKind,
  HostFileListing,
  InstallAppUpdateResponse,
  ProjectDirectoryListing,
  ProjectFileTree,
  ProjectGitHistoryPage,
  ProjectGitHistoryQuery,
  ProjectGitStatus,
  ProjectGitStatusQuery,
  ProjectSourceFile,
  SwitchProjectBranchRequest,
} from "@code-agent/protocol";

import type { CodeAgentAccessOptions } from "./access-control.js";
import type { HostAttachmentSource } from "./host-file-browser.js";
import type { ProjectImageFile } from "./project-image-file.js";
import type { ProjectOpenService } from "./project-open.js";

export interface CreateCodeAgentServerOptions {
  access?: CodeAgentAccessOptions;
  eventBufferSize?: number;
  eventSessionId?: string;
  handlerTimeoutMs?: number;
  idempotencyCacheSize?: number;
  idempotencyTtlMs?: number;
  installAppUpdate: (version: string) => Promise<InstallAppUpdateResponse>;
  loggerEnabled?: boolean;
  logDestination?: Readonly<{ write: (message: string) => void }>;
  modelCatalogCacheMaxBytes?: number;
  modelCatalogCacheTtlMs?: number;
  onBrowserConnection?: () => void;
  projectRepository: ProjectRepository;
  providerConnectionRepository: AgentProviderConnectionRepository;
  projectOpenService?: ProjectOpenService;
  provider: AgentRuntimeProvider;
  readAppInfo: () => Promise<AppInfoResponse>;
  settingsRepository: AgentSettingsRepository;
  commitProjectChanges?: (
    projectRoot: string,
    request: CommitProjectChangesRequest,
  ) => Promise<CommitProjectChangesResponse>;
  createProjectBranch?: (
    projectRoot: string,
    request: CreateProjectBranchRequest,
  ) => Promise<ProjectGitStatus>;
  readProjectGitStatus?: (
    projectRoot: string,
    query?: ProjectGitStatusQuery,
  ) => Promise<ProjectGitStatus>;
  readProjectGitHistory?: (
    projectRoot: string,
    query: ProjectGitHistoryQuery,
  ) => Promise<ProjectGitHistoryPage>;
  switchProjectBranch?: (
    projectRoot: string,
    request: SwitchProjectBranchRequest,
  ) => Promise<ProjectGitStatus>;
  readHostFileDirectory?: (kind: HostFileKind, path?: string) => Promise<HostFileListing>;
  readProjectFileTree?: (projectRoot: string, directoryPath?: string) => Promise<ProjectFileTree>;
  readProjectDirectory?: (path?: string) => Promise<ProjectDirectoryListing>;
  readProjectImageFile?: (projectRoot: string, path: string) => Promise<ProjectImageFile>;
  readProjectSourceFile?: (projectRoot: string, path: string) => Promise<ProjectSourceFile>;
  resolveProjectDirectory?: (path: string) => Promise<string>;
  resolveHostAttachment?: (kind: HostFileKind, path: string) => Promise<HostAttachmentSource>;
  staticRoot?: string;
}
