import type { CodeAgentEngine } from "@code-agent/engine-node";
import type { AppInfoResponse, InstallAppUpdateResponse } from "@code-agent/protocol";

import type { CodeAgentAccessOptions } from "./access-control.js";

export interface ServerPerformanceSample {
  readonly at: number;
  readonly point: "runtime_published";
}

export interface CreateCodeAgentServerOptions {
  readonly access?: CodeAgentAccessOptions;
  readonly allowedHosts?: readonly string[];
  readonly engine: CodeAgentEngine;
  readonly handlerTimeoutMs?: number;
  readonly installAppUpdate: (version: string) => Promise<InstallAppUpdateResponse>;
  readonly loggerEnabled?: boolean;
  readonly logDestination?: Readonly<{ write: (message: string) => void }>;
  readonly onPerformanceSample?: (sample: ServerPerformanceSample) => void;
  readonly readAppInfo: () => Promise<AppInfoResponse>;
  readonly staticRoot?: string;
}
