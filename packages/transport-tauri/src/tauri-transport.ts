import {
  CodeAgentError,
  type AssetReference,
  type CodeAgentOperation,
  type CodeAgentRequestContext,
  type CodeAgentTransport,
  type SubscribeAgentEventsOptions,
} from "@code-agent/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const OPERATION_COMMANDS: Readonly<Record<string, string>> = {
  "access.status": "access_status",
  "attachments.import_host": "attachment_import_host",
  "attachments.open": "attachment_open",
  "app.health": "app_diagnostics",
  "app.info": "app_info",
  "files.search": "file_search",
  "files.source_read": "file_source_read",
  "files.tree": "file_tree",
  "host_files.list": "host_files_list",
  "project_directories.list": "project_directories_list",
  "global_settings.get": "global_settings_get",
  "global_settings.update": "global_settings_update",
  "git.branch_create": "git_branch_create",
  "git.branch_switch": "git_branch_switch",
  "git.commit": "git_commit",
  "git.commit_diff": "git_commit_diff",
  "git.commit_files": "git_commit_files",
  "git.history": "git_history",
  "git.status": "git_status",
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
  "task_settings.get": "task_settings_get",
  "task_settings.update": "task_settings_update",
};

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
    return invoke(command, {
      ...(typeof input === "object" && input !== null ? input : {}),
      ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
      requestId: context.requestId,
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
    void options;
    throw new CodeAgentError({
      code: "unsupported_operation",
      message: "Tauri event subscriptions are not available in migration phase 2",
    });
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
        "x-code-agent-media-type": input.content.type || "application/octet-stream",
        "x-code-agent-name": encodeURIComponent(input.name),
        "x-code-agent-project-id": operationInput.projectId,
        "x-code-agent-request-id": context.requestId,
      },
    });
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path);
}
