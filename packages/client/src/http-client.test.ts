import { describe, expect, it, vi } from "vitest";

import { CodeAgentClient, CodeAgentHttpError, CodeAgentResponseError } from "./http-client.js";

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
      .mockResolvedValueOnce(jsonResponse({ provider: "codex", tasks: { list: true, read: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ ...task, status: "idle", turns: [] }));
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
