import { NodeEngineError, type CodeAgentEngine } from "@code-agent/engine-node";
import { describe, expect, it, vi } from "vitest";

import { createCodeAgentServer } from "./app.js";

function createEngine(overrides: Partial<CodeAgentEngine> = {}): CodeAgentEngine {
  return new Proxy(overrides as CodeAgentEngine, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (value !== undefined) return value;
      return () => Promise.reject(new Error(`Unexpected engine call: ${String(property)}`));
    },
  });
}

function createOptions(engine: CodeAgentEngine) {
  return {
    engine,
    installAppUpdate: () => Promise.reject(new Error("unused")),
    loggerEnabled: false,
    readAppInfo: () =>
      Promise.resolve({
        appVersion: "1.10.0",
        codexVersion: "0.147.0",
        error: null,
        latestVersion: null,
        releaseNotes: null,
        status: "current" as const,
        updateAvailable: false,
      }),
  };
}

describe("createCodeAgentServer", () => {
  it("keeps health local and closes the shared engine once", async () => {
    const close = vi.fn(() => Promise.resolve());
    const app = await createCodeAgentServer(createOptions(createEngine({ close })));

    const response = await app.inject({ headers: { host: "localhost" }, url: "/v1/health" });
    expect(response.json()).toEqual({
      runtime: { state: "ready" },
      status: "ok",
      version: 1,
    });

    await app.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns native event stream metrics with delivery counters", async () => {
    const eventMetricsGet = vi.fn(() =>
      Promise.resolve({
        projects: [
          {
            coalescedEvents: 3,
            pendingDeltas: 1,
            projectId: "code-agent",
            providerEventsReceived: 7,
            publishedEvents: 4,
            retainedEvents: 2,
            retentionEvictions: 2,
            slowSubscribers: 2,
          },
        ],
      }),
    );
    const app = await createCodeAgentServer(
      createOptions(createEngine({ close: () => Promise.resolve(), eventMetricsGet })),
    );

    const response = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/metrics/events",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projects: [
        {
          activeClients: 0,
          backpressureSignals: 0,
          coalescedEvents: 3,
          pendingDeltas: 1,
          projectId: "code-agent",
          providerEventsReceived: 7,
          publishedEvents: 4,
          retainedEvents: 2,
          retentionEvictions: 2,
          slowClientDisconnects: 2,
        },
      ],
      version: 1,
    });
    expect(eventMetricsGet).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("forwards named project operations and reuses the idempotency key", async () => {
    const project = {
      createdAt: "2026-08-12T00:00:00.000Z",
      id: "code-agent",
      name: "CodeAgent",
      rootPath: "/workspace/CodeAgent",
    };
    const projectAdd = vi.fn(() => Promise.resolve(project));
    const app = await createCodeAgentServer(
      createOptions(createEngine({ close: () => Promise.resolve(), projectAdd })),
    );

    const response = await app.inject({
      headers: {
        "content-type": "application/json",
        host: "localhost",
        "idempotency-key": "project-add-1",
      },
      method: "POST",
      payload: { rootPath: project.rootPath },
      url: "/v1/projects",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ project });
    expect(projectAdd).toHaveBeenCalledWith("project-add-1", project.rootPath);
    await app.close();
  });

  it("serializes structured native domain errors without parsing messages", async () => {
    const taskRead = vi.fn(() =>
      Promise.reject(
        new NodeEngineError({
          code: "not_found",
          message: "Task not found",
          mutationCode: "TASK_NOT_FOUND",
        }),
      ),
    );
    const app = await createCodeAgentServer(
      createOptions(createEngine({ close: () => Promise.resolve(), taskRead })),
    );
    const response = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/projects/code-agent/tasks/task-1",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "TASK_NOT_FOUND",
      message: "Task not found",
    });
    await app.close();
  });

  it("preserves unknown engine error messages", async () => {
    const taskRead = vi.fn(() => Promise.reject(new Error("git: fatal: remote rejected")));
    const app = await createCodeAgentServer(
      createOptions(createEngine({ close: () => Promise.resolve(), taskRead })),
    );

    const response = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/projects/code-agent/tasks/task-1",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "git: fatal: remote rejected",
      retryable: false,
    });
    await app.close();
  });

  it("preserves request validation messages", async () => {
    const app = await createCodeAgentServer(
      createOptions(createEngine({ close: () => Promise.resolve() })),
    );

    const response = await app.inject({
      headers: {
        "content-type": "application/json",
        host: "localhost",
        "idempotency-key": "invalid-project",
      },
      method: "POST",
      payload: {},
      url: "/v1/projects",
    });

    expect(response.statusCode).toBe(400);
    const payload = response.json<{ code: string; message: string }>();
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(payload.message).toContain("rootPath");
    await app.close();
  });
});
