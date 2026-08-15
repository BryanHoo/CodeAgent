import { describe, expect, it } from "vitest";

import { resolveProviderConnectionGateState } from "./provider-connection-gate.js";

describe("ProviderConnectionGate", () => {
  it("keeps the loading state while Runtime is starting", () => {
    expect(
      resolveProviderConnectionGateState({
        connectionError: false,
        connectionPending: true,
        connectionState: undefined,
        readinessError: false,
        readinessPending: false,
        runtimeState: "starting",
      }),
    ).toBe("loading");
  });

  it("waits for the connection read after Runtime becomes ready", () => {
    expect(
      resolveProviderConnectionGateState({
        connectionError: false,
        connectionPending: true,
        connectionState: undefined,
        readinessError: false,
        readinessPending: false,
        runtimeState: "ready",
      }),
    ).toBe("loading");
  });

  it("shows an error only after Runtime reports a terminal failure", () => {
    expect(
      resolveProviderConnectionGateState({
        connectionError: false,
        connectionPending: true,
        connectionState: undefined,
        readinessError: false,
        readinessPending: false,
        runtimeState: "failed",
      }),
    ).toBe("error");
  });
});
