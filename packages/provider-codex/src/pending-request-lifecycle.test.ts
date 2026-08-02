import type { AgentProviderEvent } from "@code-agent/core";
import { describe, expect, it, vi } from "vitest";

import type { PendingCodexRequest } from "./codex-protocol-mapping.js";
import { PendingRequestLifecycle } from "./pending-request-lifecycle.js";

describe("PendingRequestLifecycle", () => {
  it("publishes one terminal event and reuses the same in-flight resolution", async () => {
    const respond = vi.fn(() => Promise.resolve());
    const published: AgentProviderEvent[] = [];
    const publish = (event: AgentProviderEvent) => {
      published.push(event);
    };
    const lifecycle = new PendingRequestLifecycle({ publish, respond });
    const entry: PendingCodexRequest = {
      providerRequestId: 7,
      request: {
        availableDecisions: ["allow", "deny"],
        command: "pnpm test",
        createdAt: "2026-08-02T00:00:00.000Z",
        cwd: null,
        expiresAt: null,
        itemId: "item-1",
        networkAccess: null,
        projectId: "project-1",
        reason: null,
        requestId: "number:7",
        status: "pending",
        taskId: "task-1",
        turnId: "turn-1",
        type: "command_approval",
      },
    };
    lifecycle.activate(entry);

    const input = {
      itemId: "item-1",
      projectId: "project-1",
      requestId: "number:7",
      resolution: { decision: "allow" as const },
      taskId: "task-1",
      turnId: "turn-1",
      type: "command_approval" as const,
    };
    const first = lifecycle.resolve(input);
    const second = lifecycle.resolve(input);

    await expect(first).resolves.toMatchObject({ status: "resolved" });
    await expect(second).resolves.toMatchObject({ status: "resolved" });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(published.filter((event) => event.type === "pending_request.resolved")).toHaveLength(1);
  });
});
