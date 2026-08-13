import type { CodeAgentEngine } from "@code-agent/engine-node";
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
        appVersion: "1.9.0",
        codexVersion: "0.147.0",
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
    expect(response.json()).toEqual({ status: "ok", version: 1 });

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

  it("maps stable native not_found errors to the HTTP protocol", async () => {
    const taskRead = vi.fn(() => Promise.reject(new Error("not_found: task missing")));
    const app = await createCodeAgentServer(
      createOptions(createEngine({ close: () => Promise.resolve(), taskRead })),
    );
    const response = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/projects/code-agent/tasks/task-1",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await app.close();
  });
});
