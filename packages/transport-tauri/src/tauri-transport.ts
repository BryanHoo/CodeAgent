import {
  CodeAgentError,
  type AssetReference,
  type CodeAgentOperation,
  type CodeAgentRequestContext,
  type CodeAgentTransport,
  type SubscribeAgentEventsOptions,
} from "@code-agent/client";
import { invoke } from "@tauri-apps/api/core";

const OPERATION_COMMANDS: Readonly<Record<string, string>> = {
  "access.status": "access_status",
  "app.health": "app_diagnostics",
  "app.info": "app_info",
};

export class TauriCodeAgentTransport implements CodeAgentTransport {
  public cancel(requestId: string): Promise<void> {
    return invoke("cancel_operation", { requestId });
  }

  public request(
    operation: CodeAgentOperation,
    context: CodeAgentRequestContext,
  ): Promise<unknown> {
    const command = OPERATION_COMMANDS[operation.name];
    if (command === undefined) {
      return Promise.reject(
        new CodeAgentError({
          code: "unsupported_operation",
          message: `Tauri operation is not available in migration phase 2: ${operation.name}`,
        }),
      );
    }
    return invoke(command, { requestId: context.requestId });
  }

  public resolveAssetUrl(reference: AssetReference): string {
    void reference;
    throw new CodeAgentError({
      code: "unsupported_operation",
      message: "Tauri asset URLs are not available in migration phase 2",
    });
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    void options;
    throw new CodeAgentError({
      code: "unsupported_operation",
      message: "Tauri event subscriptions are not available in migration phase 2",
    });
  }
}
