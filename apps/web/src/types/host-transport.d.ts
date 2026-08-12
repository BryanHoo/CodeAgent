declare module "@code-agent/host-transport" {
  import type { CodeAgentTransport } from "@code-agent/client";

  export function createHostTransport(): CodeAgentTransport;
}
