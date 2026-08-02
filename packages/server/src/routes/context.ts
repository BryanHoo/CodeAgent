import type {
  AgentProvider,
  AgentProviderTurnInput,
  AgentRuntimeProvider,
  AgentSettingsRepository,
  AgentTaskMetadataRepository,
  PendingRequestResolutionError,
  ProjectRepository,
} from "@code-agent/core";
import type {
  AgentAttachmentKind,
  AgentCapabilities,
  AgentGlobalSettings,
  AgentModel,
  AgentModelPage,
  AgentMutationError,
  AgentProjectDefaults,
  AgentPromptInput,
  AgentTask,
  AgentTaskSettings,
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  GenerateCommitMessageRequest,
  Project,
  ProjectFileTree,
  ProjectGitStatus,
  ProjectSourceFile,
} from "@code-agent/protocol";

import type { AgentEventStream } from "../agent-event-stream.js";
import type { AttachmentStore } from "../attachment-store.js";
import type { GitCommitError } from "../git-commit.js";
import type { ProjectOpenService } from "../project-open.js";
import type { PreparedTurnFileRollback } from "../turn-file-rollback.js";
import type { prepareTurnFileRollback } from "../turn-file-rollback.js";

export class MutationHttpError extends Error {
  public constructor(
    public readonly code: AgentMutationError["code"],
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "MutationHttpError";
  }
}

export type ProjectRuntimeContext = Readonly<{
  eventStream: AgentEventStream;
  project: Project;
  provider: AgentProvider;
  transportMetrics: {
    activeClients: number;
    slowClientDisconnects: number;
  };
  unsubscribe: () => void;
}>;

export type ProjectContextResolver = (
  projectId: string,
) => Promise<ProjectRuntimeContext | undefined>;

export type RunIdempotent = <T>(
  scope: readonly string[],
  key: string,
  payload: unknown,
  action: () => Promise<T> | T,
) => Promise<T>;

export type TaskStartRecovery = Readonly<{
  fingerprint: string;
  settings: AgentTaskSettings;
  task: AgentTask;
}>;

export interface ServerRouteContext {
  readonly activeGitMutations: Set<string>;
  readonly assertCommitSelection: (
    status: ProjectGitStatus,
    request: GenerateCommitMessageRequest,
  ) => void;
  readonly assertValidProjectDefaults: (
    models: readonly AgentModel[],
    settings: AgentProjectDefaults,
  ) => void;
  readonly attachmentStore: AttachmentStore;
  readonly buildCommitMessagePrompt: (
    status: ProjectGitStatus,
    request: GenerateCommitMessageRequest,
    customPrompt: string,
  ) => string;
  readonly capabilities: AgentCapabilities;
  readonly commitProjectChanges: (
    projectRoot: string,
    request: CommitProjectChangesRequest,
  ) => Promise<CommitProjectChangesResponse>;
  readonly generateCommitMessageWithCodex: (
    provider: AgentProvider,
    prompt: string,
    settings: AgentTaskSettings,
  ) => Promise<string>;
  readonly getProjectContext: ProjectContextResolver;
  readonly fingerprintPayload: (payload: unknown) => string;
  readonly idempotencyCacheSize: number;
  readonly listModels: () => Promise<readonly AgentModel[]>;
  readonly maximumAttachmentBytes: (kind: AgentAttachmentKind) => number;
  readonly mergeTaskPinned: (task: AgentTask, pinnedTaskIds: ReadonlySet<string>) => AgentTask;
  readonly modelCatalogCache: Readonly<{ read: () => Promise<AgentModelPage> }>;
  readonly multipartEnvelopeBytes: number;
  readonly prepareFileRollback: (
    projectRoot: string,
    changes: Parameters<typeof prepareTurnFileRollback>[1],
  ) => Promise<PreparedTurnFileRollback>;
  readonly projectOpenService: ProjectOpenService;
  readonly projectContexts: Map<string, ProjectRuntimeContext>;
  readonly projectRepository: ProjectRepository;
  readonly provider: AgentRuntimeProvider;
  readonly readEffectiveGlobalSettings: (
    models?: readonly AgentModel[],
  ) => Promise<AgentGlobalSettings>;
  readonly readEffectiveProjectDefaults: (
    projectId: string,
    models?: readonly AgentModel[],
    globalSettings?: AgentGlobalSettings,
  ) => Promise<AgentProjectDefaults>;
  readonly readInheritedTaskSettings: (
    projectId: string,
    models?: readonly AgentModel[],
  ) => Promise<AgentTaskSettings>;
  readonly readEffectiveTaskSettings: (
    projectId: string,
    taskId: string,
    models?: readonly AgentModel[],
  ) => Promise<AgentTaskSettings>;
  readonly readFileTree: (projectRoot: string, directoryPath?: string) => Promise<ProjectFileTree>;
  readonly readProjectGitStatus: (projectRoot: string) => Promise<ProjectGitStatus>;
  readonly readSourceFile: (projectRoot: string, path: string) => Promise<ProjectSourceFile>;
  readonly releaseProjectContext: (projectId: string) => Promise<void>;
  readonly resolveProviderTurnInput: (
    projectId: string,
    input: AgentPromptInput,
  ) => Promise<
    Readonly<{ attachmentIds: readonly string[]; providerInput: AgentProviderTurnInput }>
  >;
  readonly runIdempotent: RunIdempotent;
  readonly selectProjectDirectory: () => Promise<string | undefined>;
  readonly settingsRepository: AgentSettingsRepository;
  readonly taskFromSnapshot: (
    snapshot: Awaited<ReturnType<AgentProvider["readTask"]>> & object,
    overrides?: Partial<Pick<AgentTask, "pinned" | "title">>,
  ) => AgentTask;
  readonly taskMetadataRepository: AgentTaskMetadataRepository;
  readonly taskStartRecoveries: Map<string, TaskStartRecovery>;
  readonly toGitCommitHttpError: (error: GitCommitError) => MutationHttpError;
  readonly toPendingRequestHttpError: (error: PendingRequestResolutionError) => MutationHttpError;
}
