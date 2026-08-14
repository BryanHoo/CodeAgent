import {
  CodeAgentError,
  type AssetReference,
  type CodeAgentOperation,
  type CodeAgentRequestContext,
  type CodeAgentTransport,
  type SubscribeAgentEventsOptions,
  normalizeCodeAgentError,
} from "@code-agent/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { startTauriEventSubscription } from "./event-subscription.js";

const OPERATION_COMMANDS: Readonly<Record<string, string>> = {
  "access.status": "access_status",
  "attachments.import_host": "attachment_import_host",
  "attachments.open": "attachment_open",
  "app.health": "app_diagnostics",
  "app.info": "app_info",
  "capabilities.get": "capabilities_get",
  "files.search": "file_search",
  "files.source_read": "file_source_read",
  "files.tree": "file_tree",
  "host_files.list": "host_files_list",
  "host.notification_show": "host_notification_show",
  "project_directories.list": "project_directories_list",
  "global_settings.get": "global_settings_get",
  "global_settings.update": "global_settings_update",
  "git.branch_create": "git_branch_create",
  "git.branch_switch": "git_branch_switch",
  "git.commit": "git_commit",
  "git.commit_message_generate": "git_commit_message_generate",
  "git.commit_diff": "git_commit_diff",
  "git.commit_files": "git_commit_files",
  "git.history": "git_history",
  "git.status": "git_status",
  "mcp_servers.list": "mcp_servers_list",
  "mcp_servers.retry": "mcp_servers_retry",
  "models.list": "models_list",
  "project_defaults.get": "project_defaults_get",
  "project_defaults.update": "project_defaults_update",
  "projects.add": "project_add",
  "projects.list": "project_list",
  "projects.open": "project_open",
  "projects.open_capabilities": "project_open_capabilities",
  "projects.remove": "project_remove",
  "projects.rename": "project_rename",
  "projects.reorder": "project_reorder",
  "provider_connection.get": "provider_connection_get",
  "provider_connection.custom_configure": "provider_custom_configure",
  "provider_connection.login_cancel": "provider_login_cancel",
  "provider_connection.logout": "provider_logout",
  "provider_connection.official_login_start": "provider_login_start",
  "skills.list": "skills_list",
  "tasks.archive": "task_archive",
  "tasks.compact": "task_compact",
  "tasks.fork": "task_fork",
  "tasks.list": "task_list",
  "tasks.pin": "task_pin",
  "tasks.read": "task_read",
  "tasks.rename": "task_rename",
  "tasks.review": "task_review",
  "tasks.start": "task_start",
  "tasks.unsubscribe": "task_unsubscribe",
  "feedback.upload": "feedback_upload",
  "pending_requests.resolve": "pending_request_resolve",
  "terminals.list": "terminals_list",
  "terminals.terminate": "terminal_terminate",
  "turns.interrupt": "turn_interrupt",
  "turns.start": "turn_start",
  "turns.steer": "turn_steer",
  "task_settings.get": "task_settings_get",
  "task_settings.update": "task_settings_update",
};

const MUTATION_OPERATIONS: ReadonlySet<string> = new Set([
  "attachments.import_host",
  "attachments.open",
  "attachments.upload",
  "feedback.upload",
  "git.branch_create",
  "git.branch_switch",
  "git.commit",
  "git.commit_message_generate",
  "global_settings.update",
  "mcp_servers.retry",
  "pending_requests.resolve",
  "project_defaults.update",
  "projects.add",
  "projects.open",
  "projects.remove",
  "projects.rename",
  "projects.reorder",
  "provider_connection.custom_configure",
  "provider_connection.login_cancel",
  "provider_connection.logout",
  "provider_connection.official_login_start",
  "tasks.archive",
  "tasks.compact",
  "tasks.fork",
  "tasks.pin",
  "tasks.rename",
  "tasks.review",
  "tasks.start",
  "tasks.unsubscribe",
  "terminals.terminate",
  "turns.interrupt",
  "turns.start",
  "turns.steer",
  "task_settings.update",
]);

export class TauriCodeAgentTransport implements CodeAgentTransport {
  public cancel(requestId: string): Promise<void> {
    return invoke("cancel_operation", { requestId });
  }

  public request(
    operation: CodeAgentOperation,
    context: CodeAgentRequestContext,
  ): Promise<unknown> {
    if (operation.name === "attachments.upload") {
      return this.uploadAttachment(operation, context);
    }
    const command = OPERATION_COMMANDS[operation.name];
    if (command === undefined) {
      return Promise.reject(
        new CodeAgentError({
          code: "unsupported_operation",
          message: `Tauri operation is not available in the current migration phase: ${operation.name}`,
        }),
      );
    }
    const input = operation.input;
    // 未指定业务幂等键时，以本次请求 ID 保持单次 mutation 的既有语义。
    const idempotencyKey = MUTATION_OPERATIONS.has(operation.name)
      ? (context.idempotencyKey ?? context.requestId)
      : undefined;
    const payload =
      operation.name === "pending_requests.resolve" && typeof input === "object" && input !== null
        ? pendingRequestPayload(input as Record<string, unknown>)
        : operation.name === "files.source_read" && typeof input === "object" && input !== null
          ? sourceReadPayload(input as Record<string, unknown>)
          : typeof input === "object" && input !== null
            ? input
            : {};
    return invoke(command, {
      ...payload,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      requestId: context.requestId,
    }).catch((error: unknown) => {
      throw normalizeCodeAgentError(error);
    });
  }

  public resolveAssetUrl(reference: AssetReference): string {
    if (reference.kind === "project-image" && isAbsolutePath(reference.path)) {
      throw new CodeAgentError({
        code: "invalid_input",
        message: "Project image asset paths must be relative",
      });
    }
    const segments = [reference.kind, reference.projectId];
    if (reference.kind === "task-attachment") {
      segments.push(reference.taskId ?? "");
    }
    segments.push(reference.attachmentId ?? reference.path);
    const path = segments.map(encodeURIComponent).join("/");
    return convertFileSrc(path, "codeagent-asset");
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    return startTauriEventSubscription(options);
  }

  private async uploadAttachment(
    operation: CodeAgentOperation,
    context: CodeAgentRequestContext,
  ): Promise<unknown> {
    const operationInput = operation.input as
      { input?: { content?: Blob; kind?: string; name?: string }; projectId?: string } | undefined;
    const input = operationInput?.input;
    if (
      input?.content === undefined ||
      input.kind === undefined ||
      input.name === undefined ||
      operationInput?.projectId === undefined
    ) {
      throw new CodeAgentError({ code: "invalid_input", message: "Attachment upload is invalid" });
    }
    const bytes = new Uint8Array(await input.content.arrayBuffer());
    return invoke("attachment_upload", bytes, {
      headers: {
        "x-code-agent-kind": input.kind,
        "x-code-agent-idempotency-key": context.idempotencyKey ?? context.requestId,
        "x-code-agent-media-type": input.content.type || "application/octet-stream",
        "x-code-agent-name": encodeURIComponent(input.name),
        "x-code-agent-project-id": operationInput.projectId,
        "x-code-agent-request-id": context.requestId,
      },
    });
  }
}

function pendingRequestPayload(input: Record<string, unknown>): Record<string, unknown> {
  const resolution = input["input"];
  if (typeof resolution !== "object" || resolution === null) return input;
  const identity = resolution as Record<string, unknown>;
  return {
    input: { ...identity, requestId: input["requestId"] },
    projectId: identity["projectId"],
  };
}

function sourceReadPayload(input: Record<string, unknown>): Record<string, unknown> {
  // Tauri Command 将分页参数作为 SourceQuery 统一反序列化。
  return {
    projectId: input["projectId"],
    query: { cursor: input["cursor"], path: input["path"] },
  };
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path);
}
