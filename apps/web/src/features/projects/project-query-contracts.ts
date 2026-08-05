import { CodeAgentClient } from "@code-agent/client";
import type { AgentTaskPage, AgentTaskSnapshot } from "@code-agent/protocol";
import type { InfiniteData } from "@tanstack/react-query";

export type CodeAgentReadClient = Pick<CodeAgentClient, "listProjects" | "listTasks" | "readTask">;
export type CodeAgentAccessClient = Pick<
  CodeAgentClient,
  "getAccessStatus" | "logoutAccess" | "pairAccess" | "subscribeUnauthorized"
>;
export type CodeAgentGitStatusClient = Pick<CodeAgentClient, "getProjectGitStatus">;
export type CodeAgentGitMutationClient = Pick<
  CodeAgentClient,
  "commitProjectChanges" | "generateCommitMessage"
>;
export type CodeAgentFileTreeClient = Pick<CodeAgentClient, "listProjectFiles">;
export type CodeAgentProjectDirectoryClient = Pick<CodeAgentClient, "listProjectDirectories">;
export type CodeAgentHostAttachmentClient = Pick<
  CodeAgentClient,
  "importHostAttachment" | "listHostFiles"
>;
export type CodeAgentSourceFileClient = Pick<CodeAgentClient, "readProjectSourceFile">;
export type CodeAgentProjectOpenClient = Pick<
  CodeAgentClient,
  "getProjectOpenCapabilities" | "openProject"
>;
export type CodeAgentRuntimeClient = Pick<
  CodeAgentClient,
  "readTask" | "subscribeEvents" | "unsubscribeTask"
>;
export type CodeAgentBackgroundTerminalClient = Pick<
  CodeAgentClient,
  "listBackgroundTerminals" | "terminateBackgroundTerminal"
>;
export type CodeAgentCapabilitiesClient = Pick<CodeAgentClient, "getCapabilities">;
export type CodeAgentModelsClient = Pick<CodeAgentClient, "listModels">;
export type CodeAgentAppUpdateClient = Pick<CodeAgentClient, "getAppInfo" | "installAppUpdate">;
export type CodeAgentMcpServersClient = Pick<CodeAgentClient, "listMcpServers">;
export type CodeAgentSkillsClient = Pick<CodeAgentClient, "listSkills">;
export type CodeAgentSettingsClient = Pick<
  CodeAgentClient,
  | "getGlobalSettings"
  | "getProjectDefaults"
  | "updateGlobalSettings"
  | "updateProjectDefaults"
  | "updateTaskSettings"
>;
export type CodeAgentMutationClient = Pick<
  CodeAgentClient,
  | "addProject"
  | "archiveTask"
  | "compactTask"
  | "forkTask"
  | "interruptTurn"
  | "importHostAttachment"
  | "listHostFiles"
  | "pinTask"
  | "removeProject"
  | "renameProject"
  | "renameTask"
  | "reorderProjects"
  | "startReview"
  | "startTask"
  | "startTurn"
  | "steerTurn"
  | "uploadAttachment"
  | "uploadFeedback"
>;
export type CodeAgentRollbackClient = Pick<CodeAgentClient, "rollbackTurn">;
export type CodeAgentPendingRequestClient = Pick<CodeAgentClient, "resolvePendingRequest">;
export type CodeAgentWorkbenchClient = CodeAgentReadClient &
  CodeAgentBackgroundTerminalClient &
  CodeAgentGitStatusClient &
  CodeAgentGitMutationClient &
  CodeAgentFileTreeClient &
  CodeAgentProjectDirectoryClient &
  CodeAgentProjectOpenClient &
  CodeAgentRuntimeClient &
  CodeAgentMutationClient &
  CodeAgentRollbackClient &
  CodeAgentPendingRequestClient &
  CodeAgentCapabilitiesClient &
  CodeAgentModelsClient &
  CodeAgentAppUpdateClient &
  CodeAgentMcpServersClient &
  CodeAgentSkillsClient &
  CodeAgentSettingsClient &
  CodeAgentSourceFileClient;
export type CodeAgentSnapshotClient = Pick<CodeAgentClient, "readTask">;

export const PROJECT_TASK_PAGE_SIZE = 5;
export const PROJECT_TASK_SEARCH_PAGE_SIZE = 100;
export const PROJECT_TASK_SEARCH_SOURCE_KEY = "search-source";
export const TASK_SNAPSHOT_GC_TIME_MS = 30_000;

export const codeAgentClient = new CodeAgentClient();

export type ProjectTaskInfiniteData = InfiniteData<AgentTaskPage, string | undefined>;
export type TaskTitleSnapshot = Pick<
  AgentTaskSnapshot,
  "id" | "projectId" | "title" | "turns" | "updatedAt"
>;
export type TaskTitleUpdateOptions = Readonly<{
  assistantReplyStarted?: boolean;
}>;
