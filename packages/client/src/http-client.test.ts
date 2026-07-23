import { describe, expect, it, vi } from "vitest";

import {
  CodeAgentClient,
  CodeAgentHttpError,
  CodeAgentMutationError,
  CodeAgentResponseError,
} from "./http-client.js";

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("CodeAgentClient", () => {
  it("builds task pagination requests and validates successful responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ data: [task], nextCursor: null }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.listTasks("project one", { cursor: "next/value", limit: 25 }),
    ).resolves.toEqual({ data: [task], nextCursor: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks?cursor=next%2Fvalue&limit=25",
    );
  });

  it("uses the configured base URL for all read methods", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "ok", version: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({
          provider: "codex",
          tasks: { list: true, read: true, start: true },
          turns: { interrupt: true, start: true },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(
        jsonResponse({
          checkpoint: { sequence: 0, sessionId: "runtime-1" },
          snapshot: { ...task, status: "idle", turns: [] },
        }),
      );
    const client = new CodeAgentClient({ baseUrl: "http://127.0.0.1:3210/", fetch: fetchMock });

    await client.getHealth();
    await client.getCapabilities();
    await client.listProjects();
    await client.readTask("task-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:3210/v1/health",
      "http://127.0.0.1:3210/v1/capabilities",
      "http://127.0.0.1:3210/v1/projects",
      "http://127.0.0.1:3210/v1/tasks/task-1",
    ]);
  });

  it("rejects non-success HTTP responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ message: "failed" }, { status: 500 }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getHealth()).rejects.toBeInstanceOf(CodeAgentHttpError);
  });

  it("sends typed task and turn mutations with idempotency keys", async () => {
    const runningTurn = {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [],
      startedAt: "2026-07-23T00:02:00.000Z",
      status: "running",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ task }))
      .mockResolvedValueOnce(jsonResponse({ taskId: task.id, turn: runningTurn }))
      .mockResolvedValueOnce(
        jsonResponse({ status: "interrupting", taskId: task.id, turnId: runningTurn.id }),
      );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.startTask("code-agent", { idempotencyKey: "task-key" });
    await client.startTurn(
      task.id,
      { text: "继续实现", type: "text" },
      { idempotencyKey: "turn-key" },
    );
    await client.interruptTurn(task.id, runningTurn.id, { idempotencyKey: "interrupt-key" });

    const [taskCall, turnCall, interruptCall] = fetchMock.mock.calls;
    expect(taskCall?.[0]).toBe("/v1/projects/code-agent/tasks");
    expect(taskCall?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(taskCall?.[1]?.headers).get("idempotency-key")).toBe("task-key");
    expect(turnCall?.[0]).toBe("/v1/tasks/task-1/turns");
    expect(turnCall?.[1]).toMatchObject({
      body: JSON.stringify({ input: { text: "继续实现", type: "text" } }),
      method: "POST",
    });
    expect(new Headers(turnCall?.[1]?.headers).get("idempotency-key")).toBe("turn-key");
    expect(interruptCall?.[0]).toBe("/v1/turns/turn-1/interrupt");
    expect(interruptCall?.[1]).toMatchObject({
      body: JSON.stringify({ taskId: "task-1" }),
      method: "POST",
    });
    expect(new Headers(interruptCall?.[1]?.headers).get("idempotency-key")).toBe("interrupt-key");
  });

  it("validates and exposes structured mutation errors", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: "PROVIDER_ERROR", message: "Agent provider request failed", retryable: true },
        { status: 502, statusText: "Bad Gateway" },
      ),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    const error = await client.startTask("code-agent").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CodeAgentMutationError);
    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      message: "Agent provider request failed",
      retryable: true,
      status: 502,
    });
  });

  it("rejects malformed mutation error responses at the protocol boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "PROVIDER_ERROR", message: "missing retryable" }, { status: 502 }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.startTask("code-agent")).rejects.toBeInstanceOf(CodeAgentResponseError);
  });

  it("rejects invalid JSON and schema mismatches at the boundary", async () => {
    const invalidJsonFetch = vi.fn<typeof fetch>();
    invalidJsonFetch.mockResolvedValue(new Response("{"));
    const invalidSchemaFetch = vi.fn<typeof fetch>();
    invalidSchemaFetch.mockResolvedValue(
      jsonResponse({ data: [{ ...task, pinned: undefined }], nextCursor: null }),
    );

    await expect(
      new CodeAgentClient({ fetch: invalidJsonFetch }).listProjects(),
    ).rejects.toBeInstanceOf(CodeAgentResponseError);
    await expect(
      new CodeAgentClient({ fetch: invalidSchemaFetch }).listTasks("code-agent"),
    ).rejects.toBeInstanceOf(CodeAgentResponseError);
  });
});
