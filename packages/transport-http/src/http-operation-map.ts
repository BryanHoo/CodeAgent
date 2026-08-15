import {
  CodeAgentError,
  type CodeAgentOperation,
  type MutationOptions,
  type ReadOptions,
} from "@code-agent/client";

import type { CodeAgentClient as HttpRouteClient } from "./http-client.js";

type AsyncMethod = (...args: unknown[]) => Promise<unknown>;
type MethodCall = Readonly<{ args: unknown[]; method: string }>;

function operationInput(operation: CodeAgentOperation): Record<string, unknown> {
  return (operation.input ?? {}) as Record<string, unknown>;
}

export async function executeHttpOperation(
  client: HttpRouteClient,
  operation: CodeAgentOperation,
  readOptions: ReadOptions,
  mutationOptions: MutationOptions,
): Promise<unknown> {
  const input = operationInput(operation);
  const call = mapOperation(operation.name, input, readOptions, mutationOptions);
  const method = (client as unknown as Record<string, AsyncMethod>)[call.method];
  if (method === undefined) {
    throw new CodeAgentError({
      code: "unsupported_operation",
      message: `Unsupported HTTP operation: ${operation.name}`,
    });
  }
  return method.apply(client, call.args);
}

function mapOperation(
  name: string,
  input: Record<string, unknown>,
  readOptions: ReadOptions,
  mutationOptions: MutationOptions,
): MethodCall {
  switch (name) {
    case "app.health":
      return { args: [readOptions], method: "getHealth" };
    case "app.info":
      return { args: [readOptions], method: "getAppInfo" };
    case "app.update_install":
      return { args: [input["version"], mutationOptions], method: "installAppUpdate" };
    case "access.status":
      return { args: [readOptions], method: "getAccessStatus" };
    case "access.pair":
      return { args: [input["code"]], method: "pairAccess" };
    case "access.logout":
      return { args: [], method: "logoutAccess" };
    case "capabilities.get":
      return { args: [readOptions], method: "getCapabilities" };
    case "models.list":
      return { args: [readOptions], method: "listModels" };
    case "provider_connection.get":
      return { args: [readOptions], method: "getProviderConnection" };
    case "provider_connection.official_login_start":
      return { args: [mutationOptions], method: "startOfficialProviderLogin" };
    case "provider_connection.login_cancel":
      return { args: [input["loginId"], mutationOptions], method: "cancelProviderLogin" };
    case "provider_connection.custom_configure":
      return { args: [input["input"], mutationOptions], method: "configureCustomProvider" };
    case "provider_connection.logout":
      return { args: [mutationOptions], method: "logoutProvider" };
    case "global_settings.get":
      return { args: [readOptions], method: "getGlobalSettings" };
    case "global_settings.update":
      return { args: [input["settings"], mutationOptions], method: "updateGlobalSettings" };
    case "skills.list":
      return { args: [input["projectId"], readOptions], method: "listSkills" };
    case "mcp_servers.list":
      return { args: [input["projectId"], input["taskId"], readOptions], method: "listMcpServers" };
    case "mcp_servers.retry":
      return {
        args: [input["projectId"], input["taskId"], mutationOptions],
        method: "retryMcpServers",
      };
    case "projects.list":
      return { args: [readOptions], method: "listProjects" };
    case "project_directories.list":
      return {
        args: [input["path"], input["showHidden"], readOptions],
        method: "listProjectDirectories",
      };
    case "host_files.list":
      return {
        args: [input["kind"], input["path"], input["showHidden"], readOptions],
        method: "listHostFiles",
      };
    case "projects.reorder":
      return { args: [input["projectIds"], mutationOptions], method: "reorderProjects" };
    case "project_defaults.get":
      return { args: [input["projectId"], readOptions], method: "getProjectDefaults" };
    case "project_defaults.update":
      return {
        args: [input["projectId"], input["settings"], mutationOptions],
        method: "updateProjectDefaults",
      };
    case "projects.add":
      return { args: [input["rootPath"], mutationOptions], method: "addProject" };
    case "projects.rename":
      return {
        args: [input["projectId"], input["name"], mutationOptions],
        method: "renameProject",
      };
    case "projects.remove":
      return { args: [input["projectId"], mutationOptions], method: "removeProject" };
    case "projects.open_capabilities":
      return { args: [input["projectId"], readOptions], method: "getProjectOpenCapabilities" };
    case "projects.open":
      return {
        args: [input["projectId"], input["request"], mutationOptions],
        method: "openProject",
      };
    case "git.status":
      return {
        args: [input["projectId"], input["query"], readOptions],
        method: "getProjectGitStatus",
      };
    case "git.history":
      return {
        args: [input["projectId"], input["query"], readOptions],
        method: "getProjectGitHistory",
      };
    case "git.commit_files":
      return {
        args: [input["projectId"], input["query"], readOptions],
        method: "getProjectGitCommitFiles",
      };
    case "git.commit_diff":
      return {
        args: [input["projectId"], input["query"], readOptions],
        method: "getProjectGitCommitFileDiff",
      };
    case "git.branch_switch":
      return {
        args: [input["projectId"], input["request"], mutationOptions],
        method: "switchProjectBranch",
      };
    case "git.branch_create":
      return {
        args: [input["projectId"], input["request"], mutationOptions],
        method: "createProjectBranch",
      };
    case "git.commit_message_generate":
      return {
        args: [input["projectId"], input["request"], mutationOptions],
        method: "generateCommitMessage",
      };
    case "git.commit":
      return {
        args: [input["projectId"], input["request"], mutationOptions],
        method: "commitProjectChanges",
      };
    case "files.tree":
      return {
        args: [input["projectId"], input["directoryPath"], readOptions],
        method: "listProjectFiles",
      };
    case "files.search":
      return {
        args: [input["projectId"], input["query"], readOptions],
        method: "searchProjectFiles",
      };
    case "files.source_read":
      return {
        args: [input["projectId"], input["path"], input["cursor"], readOptions],
        method: "readProjectSourceFile",
      };
    case "tasks.list":
      return { args: [input["projectId"], input["options"], readOptions], method: "listTasks" };
    case "tasks.read":
      return { args: [input["projectId"], input["taskId"], readOptions], method: "readTask" };
    case "attachments.open":
      return {
        args: [input["projectId"], input["taskId"], input["attachmentId"], mutationOptions],
        method: "openTaskAttachment",
      };
    case "terminals.list":
      return {
        args: [input["projectId"], input["taskId"], readOptions],
        method: "listBackgroundTerminals",
      };
    case "terminals.terminate":
      return {
        args: [input["projectId"], input["taskId"], input["terminalId"], mutationOptions],
        method: "terminateBackgroundTerminal",
      };
    case "task_settings.get":
      return {
        args: [input["projectId"], input["taskId"], readOptions],
        method: "getTaskSettings",
      };
    case "task_settings.update":
      return {
        args: [input["projectId"], input["taskId"], input["settings"], mutationOptions],
        method: "updateTaskSettings",
      };
    case "tasks.start":
      return { args: [input["projectId"], mutationOptions], method: "startTask" };
    case "tasks.pin":
      return {
        args: [input["projectId"], input["taskId"], input["pinned"], mutationOptions],
        method: "pinTask",
      };
    case "tasks.rename":
      return {
        args: [input["projectId"], input["taskId"], input["title"], mutationOptions],
        method: "renameTask",
      };
    case "tasks.archive":
      return {
        args: [input["projectId"], input["taskId"], mutationOptions],
        method: "archiveTask",
      };
    case "tasks.unsubscribe":
      return { args: [input["projectId"], input["taskId"]], method: "unsubscribeTask" };
    case "tasks.review":
      return {
        args: [input["projectId"], input["taskId"], input["input"], mutationOptions],
        method: "startReview",
      };
    case "tasks.compact":
      return {
        args: [input["projectId"], input["taskId"], mutationOptions],
        method: "compactTask",
      };
    case "tasks.fork":
      return { args: [input["projectId"], input["taskId"], mutationOptions], method: "forkTask" };
    case "feedback.upload":
      return {
        args: [input["projectId"], input["taskId"], input["input"], mutationOptions],
        method: "uploadFeedback",
      };
    case "attachments.upload":
      return {
        args: [input["projectId"], input["input"], mutationOptions],
        method: "uploadAttachment",
      };
    case "attachments.import_host":
      return {
        args: [input["projectId"], input["kind"], input["path"], mutationOptions],
        method: "importHostAttachment",
      };
    case "turns.start":
      return {
        args: [
          input["projectId"],
          input["taskId"],
          input["input"],
          input["turnOptions"],
          mutationOptions,
        ],
        method: "startTurn",
      };
    case "turns.steer":
      return {
        args: [
          input["projectId"],
          input["taskId"],
          input["turnId"],
          input["input"],
          mutationOptions,
        ],
        method: "steerTurn",
      };
    case "turns.interrupt":
      return {
        args: [input["projectId"], input["taskId"], input["turnId"], mutationOptions],
        method: "interruptTurn",
      };
    case "pending_requests.resolve": {
      const request = { ...(input["input"] as object), requestId: input["requestId"] };
      return {
        args: [request, (input["input"] as Record<string, unknown>)["resolution"], mutationOptions],
        method: "resolvePendingRequest",
      };
    }
    default:
      return { args: [], method: "" };
  }
}
