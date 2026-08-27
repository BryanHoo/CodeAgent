export type ProviderKind = "codex" | "claude";

export type RuntimeStatus = "stopped" | "starting" | "ready" | "failed";

export type RuntimeSnapshot = {
  schemaVersion: number;
  status: RuntimeStatus;
  provider: ProviderKind | null;
  lastSeq: number;
};

export type RuntimeStatusEvent = {
  type: "runtimeStatus";
  data: {
    seq: number;
    status: RuntimeStatus;
    provider: ProviderKind | null;
  };
};

export type AppEvent = RuntimeStatusEvent;
