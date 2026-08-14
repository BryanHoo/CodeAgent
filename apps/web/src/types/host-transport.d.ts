declare module "@code-agent/host-transport" {
  import type { CodeAgentClient, CodeAgentTransport } from "@code-agent/client";

  export type HostNotificationApi = Readonly<{
    show: (title: string, options: Readonly<{ body: string; tag: string }>) => Promise<void>;
  }>;

  export function createHostTransport(): CodeAgentTransport;
  export function createHostNotificationApi(
    client: CodeAgentClient,
  ): HostNotificationApi | undefined;
}
