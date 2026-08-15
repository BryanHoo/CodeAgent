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
            queueHighWaterMark: 8,
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
          maxBufferedAmount: 0,
          pendingDeltas: 1,
          projectId: "code-agent",
          providerEventsReceived: 7,
          publishedEvents: 4,
          queueHighWaterMark: 8,
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

  it("reuses controlled file preview and open operations for temporary tasks", async () => {
    const fileSourceRead = vi.fn(() =>
      Promise.resolve({ content: "temporary note\n", nextCursor: null, path: "/tmp/note.txt" }),
    );
    const projectImage = vi.fn(() =>
      Promise.resolve(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    );
    const projectOpen = vi.fn(() =>
      Promise.resolve({ appId: "system-default", path: "/tmp/archive.bin" }),
    );
    const app = await createCodeAgentServer(
      createOptions(
        createEngine({
          close: () => Promise.resolve(),
          fileSourceRead,
          projectImage,
          projectOpen,
        }),
      ),
    );

    const sourceResponse = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/temporary/files/source?path=%2Ftmp%2Fnote.txt",
    });
    const imageResponse = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/temporary/files/image?path=%2Ftmp%2Fimage.png",
    });
    const openResponse = await app.inject({
      headers: {
        "content-type": "application/json",
        host: "localhost",
        "idempotency-key": "temporary-open-1",
      },
      method: "POST",
      payload: { appId: "system-default", path: "/tmp/archive.bin" },
      url: "/v1/temporary/open",
    });
    const hiddenProjectResponse = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/projects/temporary/files/source?path=%2Ftmp%2Fnote.txt",
    });

    expect(sourceResponse.statusCode).toBe(200);
    expect(imageResponse.statusCode).toBe(200);
    expect(openResponse.statusCode).toBe(200);
    expect(hiddenProjectResponse.statusCode).toBe(404);
    expect(fileSourceRead).toHaveBeenCalledWith(
      expect.any(String),
      "temporary",
      "/tmp/note.txt",
      undefined,
    );
    expect(projectImage).toHaveBeenCalledWith(expect.any(String), "temporary", "/tmp/image.png");
    expect(projectOpen).toHaveBeenCalledWith(
      "temporary-open-1",
      "temporary",
      "system-default",
      "/tmp/archive.bin",
    );
    expect(fileSourceRead).toHaveBeenCalledTimes(1);
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

  it("forwards task turn pagination cursors", async () => {
    const page = { data: [], nextCursor: null };
    const taskTurnList = vi.fn(() => Promise.resolve(page));
    const app = await createCodeAgentServer(
      createOptions(createEngine({ close: () => Promise.resolve(), taskTurnList })),
    );

    const response = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/projects/code-agent/tasks/task-1/turns?cursor=older%2Fvalue",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(page);
    expect(taskTurnList).toHaveBeenCalledWith(
      expect.any(String),
      "code-agent",
      "task-1",
      "older/value",
    );
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
