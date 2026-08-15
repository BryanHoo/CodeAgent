declare module "@code-agent/host-transport" {
  import type { CodeAgentClient, CodeAgentTransport } from "@code-agent/client";

  export type HostNotificationTarget = Readonly<{
    projectId: string;
    taskId: string;
  }>;

  export type HostNotificationApi = Readonly<{
    onAction: (listener: (target: HostNotificationTarget) => void) => Promise<() => void>;
    show: (
      title: string,
      options: Readonly<{ body: string; projectId: string; tag: string; taskId: string }>,
    ) => Promise<void>;
  }>;

  export function createHostTransport(): CodeAgentTransport;
  export function createHostNotificationApi(
    client: CodeAgentClient,
  ): HostNotificationApi | undefined;
}
