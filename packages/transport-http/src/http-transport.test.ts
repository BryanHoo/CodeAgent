import { HealthResponseSchema, ProjectPageSchema } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";

import { HttpCodeAgentTransport } from "./http-transport.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("HttpCodeAgentTransport", () => {
  it("maps domain operations to the existing HTTP routes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }));
    const transport = new HttpCodeAgentTransport({ fetch: fetchMock });

    await transport.request(
      { name: "app.health", output: HealthResponseSchema },
      { requestId: "health-request" },
    );
    await transport.request(
      { name: "projects.list", output: ProjectPageSchema },
      { requestId: "projects-request" },
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/v1/health", "/v1/projects"]);
  });

  it("forwards cancellation and idempotency context", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        project: {
          createdAt: "2026-08-12T00:00:00.000Z",
          id: "code-agent",
          name: "CodeAgent",
          rootPath: "/workspace/code-agent",
        },
      }),
    );
    const transport = new HttpCodeAgentTransport({ fetch: fetchMock });
    const controller = new AbortController();

    await transport.request(
      {
        input: { rootPath: "/workspace/code-agent" },
        name: "projects.add",
        output: ProjectPageSchema,
      },
      { idempotencyKey: "add-project-key", requestId: "add-project", signal: controller.signal },
    );

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("add-project-key");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the configured base URL for host assets", () => {
    const transport = new HttpCodeAgentTransport({ baseUrl: "http://127.0.0.1:3210/" });

    expect(
      transport.resolveAssetUrl({
        attachmentId: "attachment/1",
        kind: "task-attachment",
        path: "ignored.png",
        projectId: "code agent",
        taskId: "task/1",
      }),
    ).toBe(
      "http://127.0.0.1:3210/v1/projects/code%20agent/tasks/task%2F1/attachments/attachment%2F1",
    );
  });
});
