import type {
  AgentRuntimeProvider,
  AgentSettingsRepository,
  ProjectRepository,
} from "@code-agent/core";
import type {
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  HostFileKind,
  HostFileListing,
  ProjectDirectoryListing,
  ProjectFileTree,
  ProjectGitStatus,
  ProjectSourceFile,
} from "@code-agent/protocol";

import type { CodeAgentAccessOptions } from "./access-control.js";
import type { HostAttachmentSource } from "./host-file-browser.js";
import type { ProjectImageFile } from "./project-image-file.js";
import type { ProjectOpenService } from "./project-open.js";
import type { PreparedTurnFileRollback, prepareTurnFileRollback } from "./turn-file-rollback.js";

export interface CreateCodeAgentServerOptions {
  access?: CodeAgentAccessOptions;
  eventBufferSize?: number;
  eventSessionId?: string;
  handlerTimeoutMs?: number;
  idempotencyCacheSize?: number;
  idempotencyTtlMs?: number;
  loggerEnabled?: boolean;
  logDestination?: Readonly<{ write: (message: string) => void }>;
  modelCatalogCacheMaxBytes?: number;
  modelCatalogCacheTtlMs?: number;
  onBrowserConnection?: () => void;
  projectRepository: ProjectRepository;
  projectOpenService?: ProjectOpenService;
  provider: AgentRuntimeProvider;
  settingsRepository: AgentSettingsRepository;
  commitProjectChanges?: (
    projectRoot: string,
    request: CommitProjectChangesRequest,
  ) => Promise<CommitProjectChangesResponse>;
  readProjectGitStatus?: (projectRoot: string) => Promise<ProjectGitStatus>;
  readHostFileDirectory?: (kind: HostFileKind, path?: string) => Promise<HostFileListing>;
  readProjectFileTree?: (projectRoot: string, directoryPath?: string) => Promise<ProjectFileTree>;
  readProjectDirectory?: (path?: string) => Promise<ProjectDirectoryListing>;
  readProjectImageFile?: (projectRoot: string, path: string) => Promise<ProjectImageFile>;
  readProjectSourceFile?: (projectRoot: string, path: string) => Promise<ProjectSourceFile>;
  prepareTurnFileRollback?: (
    projectRoot: string,
    changes: Parameters<typeof prepareTurnFileRollback>[1],
  ) => Promise<PreparedTurnFileRollback>;
  resolveProjectDirectory?: (path: string) => Promise<string>;
  resolveHostAttachment?: (kind: HostFileKind, path: string) => Promise<HostAttachmentSource>;
  staticRoot?: string;
}
