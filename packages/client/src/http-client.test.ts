import { describe, expect, it, vi } from "vitest";
import type { PendingRequest } from "@code-agent/protocol";

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

const modelPage = {
  data: [
    {
      defaultReasoningEffort: "high",
      description: "适合复杂编码任务",
      displayName: "GPT-5.6 Sol",
      id: "gpt-5.6-sol",
      isDefault: true,
      supportedReasoningEfforts: [{ description: "深入分析", id: "high" }],
    },
  ],
  nextCursor: null,
};
const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const attachment = {
  id: "attachment-1",
  mediaType: "image/png",
  name: "screen.png",
  size: 68,
};

const pendingRequest: PendingRequest = {
  availableDecisions: ["allow", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:02:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-1",
  networkAccess: null,
  projectId: "code-agent",
  reason: null,
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
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

  it("reads the provider model catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(modelPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listModels()).resolves.toEqual(modelPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/models");
  });

  it("reads and validates a project's staged and unstaged Git changes", async () => {
    const gitStatus = {
      staged: [],
      unstaged: [
        {
          diff: "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+export {};",
          kind: "create",
          path: "new.ts",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(gitStatus));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getProjectGitStatus("project one")).resolves.toEqual(gitStatus);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20one/git/status");
  });

  it("reads and validates a bounded project source preview", async () => {
    const sourceFile = {
      content: "### 11.7 认证\n",
      path: "docs/architecture-design.md",
      truncated: true,
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(sourceFile));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.readProjectSourceFile(
        "project one",
        "/workspace/CodeAgent/docs/architecture-design.md",
      ),
    ).resolves.toEqual(sourceFile);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/files/source?path=%2Fworkspace%2FCodeAgent%2Fdocs%2Farchitecture-design.md",
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
          snapshot: { ...task, contextUsage: null, pendingRequests: [], status: "idle", turns: [] },
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
      .mockResolvedValueOnce(jsonResponse({ attachment }))
      .mockResolvedValueOnce(jsonResponse({ taskId: task.id, turn: runningTurn }))
      .mockResolvedValueOnce(
        jsonResponse({ status: "interrupting", taskId: task.id, turnId: runningTurn.id }),
      );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.startTask("code-agent", { idempotencyKey: "task-key" });
    await client.uploadAttachment(
      { dataUrl: pixelDataUrl, name: attachment.name },
      { idempotencyKey: "attachment-key" },
    );
    await client.startTurn(
      task.id,
      { attachments: [{ id: attachment.id }], text: "继续实现", type: "prompt" },
      { approvalPolicy: "on-request", model: "gpt-5.6-sol", reasoningEffort: "high" },
      { idempotencyKey: "turn-key" },
    );
    await client.interruptTurn(task.id, runningTurn.id, { idempotencyKey: "interrupt-key" });

    const [taskCall, attachmentCall, turnCall, interruptCall] = fetchMock.mock.calls;
    expect(taskCall?.[0]).toBe("/v1/projects/code-agent/tasks");
    expect(taskCall?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(taskCall?.[1]?.headers).get("idempotency-key")).toBe("task-key");
    expect(attachmentCall?.[0]).toBe("/v1/attachments");
    expect(attachmentCall?.[1]).toMatchObject({
      body: JSON.stringify({ dataUrl: pixelDataUrl, name: "screen.png" }),
      method: "POST",
    });
    expect(new Headers(attachmentCall?.[1]?.headers).get("idempotency-key")).toBe("attachment-key");
    expect(turnCall?.[0]).toBe("/v1/tasks/task-1/turns");
    expect(turnCall?.[1]).toMatchObject({
      body: JSON.stringify({
        input: {
          attachments: [{ id: "attachment-1" }],
          text: "继续实现",
          type: "prompt",
        },
        options: {
          approvalPolicy: "on-request",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
        },
      }),
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

  it("sends typed pending request resolutions with full identity", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ request: { ...pendingRequest, status: "resolved" } }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.resolvePendingRequest(
        pendingRequest,
        { decision: "allow" },
        { idempotencyKey: "resolve-key" },
      ),
    ).resolves.toMatchObject({ request: { status: "resolved" } });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/v1/pending-requests/number%3A7/resolve");
    expect(call?.[1]).toMatchObject({
      body: JSON.stringify({
        itemId: "command-1",
        projectId: "code-agent",
        resolution: { decision: "allow" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "command_approval",
      }),
      method: "POST",
    });
    expect(new Headers(call?.[1]?.headers).get("idempotency-key")).toBe("resolve-key");
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
