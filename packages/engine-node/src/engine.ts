import type { NativeEventEngine } from "./event-subscription.js";
import { normalizeNodeEngineError } from "./errors.js";
import { loadNativeBinding, type NativeBindingLoaderOptions } from "./native-binding.js";

export interface NodeEngineOptions {
  readonly appVersion: string;
  readonly attachmentRoot: string;
  readonly codexHome: string;
  readonly codexPath: string;
  readonly databasePath: string;
  readonly temporaryWorkspace: string;
}

export interface NodeEngineDiagnostic {
  readonly codexVersion: string;
  readonly foreignKeys: boolean;
  readonly integrityCheck: string;
  readonly journalMode: string;
  readonly migrationVersion: number;
}

export interface NodeProcessExit {
  readonly code?: number;
  readonly signal?: number;
}

export interface NodeEventStreamMetrics {
  readonly coalescedEvents: number;
  readonly pendingDeltas: number;
  readonly projectId: string;
  readonly providerEventsReceived: number;
  readonly publishedEvents: number;
  readonly retainedEvents: number;
  readonly retentionEvictions: number;
  readonly slowSubscribers: number;
}

export interface NodeEventStreamMetricsPage {
  readonly projects: readonly NodeEventStreamMetrics[];
}

type JsonResult = Promise<unknown>;

/** Server 与 CLI 共享的具名 Engine 边界；禁止退化为字符串操作分发器。 */
export interface CodeAgentEngine extends NativeEventEngine {
  attachmentImportHost(
    requestId: string,
    projectId: string,
    kind: string,
    path: string,
  ): JsonResult;
  attachmentOpen(
    requestId: string,
    projectId: string,
    taskId: string,
    attachmentId: string,
  ): Promise<void>;
  attachmentPendingRead(
    requestId: string,
    projectId: string,
    attachmentId: string,
  ): Promise<Uint8Array>;
  attachmentTaskRead(
    requestId: string,
    projectId: string,
    taskId: string,
    attachmentId: string,
  ): Promise<Uint8Array>;
  attachmentUpload(
    requestId: string,
    projectId: string,
    kind: string,
    mediaType: string,
    name: string,
    bytes: Uint8Array,
  ): JsonResult;
  cancelOperation(requestId: string): Promise<boolean>;
  capabilitiesGet(requestId: string): JsonResult;
  close(): Promise<void>;
  diagnose(): Promise<NodeEngineDiagnostic>;
  eventMetricsGet(requestId: string): Promise<NodeEventStreamMetricsPage>;
  fileSearch(requestId: string, projectId: string, query: string): JsonResult;
  fileSourceRead(requestId: string, projectId: string, path: string, cursor?: number): JsonResult;
  fileTree(requestId: string, projectId: string, path?: string): JsonResult;
  gitBranchCreate(
    requestId: string,
    projectId: string,
    branch: string,
    expectedSnapshot: string,
  ): JsonResult;
  gitBranchSwitch(
    requestId: string,
    projectId: string,
    branch: string,
    expectedSnapshot: string,
  ): JsonResult;
  gitCommit(requestId: string, projectId: string, request: unknown): JsonResult;
  gitCommitDiff(requestId: string, projectId: string, query: unknown): JsonResult;
  gitCommitFiles(requestId: string, projectId: string, query: unknown): JsonResult;
  gitCommitMessageGenerate(requestId: string, projectId: string, request: unknown): JsonResult;
  gitHistory(requestId: string, projectId: string, query: unknown): JsonResult;
  gitStatus(requestId: string, projectId: string, repository?: string): JsonResult;
  globalSettingsGet(requestId: string): JsonResult;
  globalSettingsUpdate(requestId: string, settings: unknown): JsonResult;
  hostFilesList(requestId: string, kind: string, path?: string): JsonResult;
  modelsList(requestId: string): JsonResult;
  pendingRequestResolve(requestId: string, projectId: string, input: unknown): JsonResult;
  projectAdd(requestId: string, rootPath: string): JsonResult;
  projectDefaultsGet(requestId: string, projectId: string): JsonResult;
  projectDefaultsUpdate(requestId: string, projectId: string, settings: unknown): JsonResult;
  projectDirectoriesList(requestId: string, path?: string): JsonResult;
  projectImage(requestId: string, projectId: string, path: string): Promise<Uint8Array>;
  projectList(requestId: string): JsonResult;
  projectOpen(requestId: string, projectId: string, appId: string, path?: string): JsonResult;
  projectOpenCapabilities(requestId: string): JsonResult;
  projectRead(requestId: string, projectId: string): JsonResult;
  projectRemove(requestId: string, projectId: string): Promise<void>;
  projectRename(requestId: string, projectId: string, name: string): JsonResult;
  projectReorder(requestId: string, projectIds: readonly string[]): JsonResult;
  providerConnectionGet(requestId: string): JsonResult;
  providerCustomConfigure(requestId: string, input: unknown): JsonResult;
  providerLoginCancel(requestId: string, loginId: string): JsonResult;
  providerLoginStart(requestId: string): JsonResult;
  providerLogout(requestId: string): JsonResult;
  skillsList(requestId: string, projectId: string): JsonResult;
  taskArchive(requestId: string, projectId: string, taskId: string): Promise<void>;
  taskCompact(requestId: string, projectId: string, taskId: string): Promise<void>;
  taskFeedbackUpload(
    requestId: string,
    projectId: string,
    taskId: string,
    input: unknown,
  ): Promise<void>;
  taskFork(requestId: string, projectId: string, taskId: string): JsonResult;
  taskList(requestId: string, projectId: string, input: unknown): JsonResult;
  taskMcpReload(requestId: string, projectId: string, taskId: string): JsonResult;
  taskMcpServers(requestId: string, projectId: string, taskId: string): JsonResult;
  taskPin(requestId: string, projectId: string, taskId: string, pinned: boolean): JsonResult;
  taskRead(requestId: string, projectId: string, taskId: string): JsonResult;
  taskRename(requestId: string, projectId: string, taskId: string, title: string): JsonResult;
  taskSettingsGet(requestId: string, projectId: string, taskId: string): JsonResult;
  taskSettingsUpdate(
    requestId: string,
    projectId: string,
    taskId: string,
    settings: unknown,
  ): JsonResult;
  taskStart(requestId: string, projectId: string, input: unknown): JsonResult;
  taskTerminalTerminate(
    requestId: string,
    projectId: string,
    taskId: string,
    terminalId: string,
  ): Promise<boolean>;
  taskTerminals(requestId: string, projectId: string, taskId: string): JsonResult;
  taskUnsubscribe(requestId: string, projectId: string, taskId: string): Promise<string>;
  turnInterrupt(
    requestId: string,
    projectId: string,
    taskId: string,
    turnId: string,
  ): Promise<void>;
  turnReviewStart(
    requestId: string,
    projectId: string,
    taskId: string,
    target: unknown,
  ): JsonResult;
  turnStart(requestId: string, projectId: string, taskId: string, input: unknown): JsonResult;
  turnSteer(
    requestId: string,
    projectId: string,
    taskId: string,
    turnId: string,
    input: unknown,
  ): Promise<void>;
  waitForExit(): Promise<NodeProcessExit>;
}

export async function openNodeEngine(
  options: NodeEngineOptions,
  loader: NativeBindingLoaderOptions = {},
): Promise<CodeAgentEngine> {
  let engine: CodeAgentEngine;
  try {
    engine = (await loadNativeBinding(loader).NodeEngine.open(options)) as CodeAgentEngine;
  } catch (error) {
    throw normalizeNodeEngineError(error);
  }
  return new Proxy(engine, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        try {
          const result = Reflect.apply(value, target, args) as unknown;
          return result instanceof Promise
            ? result.catch((error: unknown) => Promise.reject(normalizeNodeEngineError(error)))
            : result;
        } catch (error) {
          throw normalizeNodeEngineError(error);
        }
      };
    },
  });
}
