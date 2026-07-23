import type { AgentProvider } from "@code-agent/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodeAgentServer } from "./app.js";

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
} as const;

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
} as const;

const snapshot = {
  ...task,
  status: "idle" as const,
  turns: [],
};

const closeCallbacks: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function createProvider() {
  const getCapabilities = vi.fn(() =>
    Promise.resolve({
      provider: "codex",
      tasks: { list: true, read: true },
    }),
  );
  const listTasks = vi.fn(() => Promise.resolve({ data: [task], nextCursor: "next" }));
  const readTask = vi.fn((taskId: string) =>
    Promise.resolve(taskId === task.id ? snapshot : undefined),
  );
  const provider: AgentProvider = {
    getCapabilities,
    listTasks,
    readTask,
  };
  return { listTasks, provider };
}

async function createHarness() {
  const { listTasks, provider } = createProvider();
  const app = await createCodeAgentServer({ project, provider });
  closeCallbacks.push(() => app.close());
  return { app, listTasks };
}

describe("CodeAgent Server", () => {
  it("serves health, capabilities, and projects", async () => {
    const { app } = await createHarness();

    const healthResponse = await app.inject({ method: "GET", url: "/v1/health" });
    const capabilitiesResponse = await app.inject({ method: "GET", url: "/v1/capabilities" });
    const projectsResponse = await app.inject({ method: "GET", url: "/v1/projects" });

    expect(healthResponse.json()).toEqual({
      status: "ok",
      version: 1,
    });
    expect(capabilitiesResponse.json()).toEqual({
      provider: "codex",
      tasks: { list: true, read: true },
    });
    expect(projectsResponse.json()).toEqual({ data: [project], nextCursor: null });
  });

  it("lists project tasks with validated pagination", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?cursor=cursor&limit=25",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [task], nextCursor: "next" });
    expect(listTasks).toHaveBeenCalledWith({ cursor: "cursor", limit: 25 });
  });

  it("reads a structured task snapshot", async () => {
    const { app } = await createHarness();
    const response = await app.inject({ method: "GET", url: "/v1/tasks/task-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(snapshot);
  });

  it("returns 404 for unknown projects and tasks", async () => {
    const { app, listTasks } = await createHarness();
    const projectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/tasks",
    });
    const taskResponse = await app.inject({ method: "GET", url: "/v1/tasks/missing" });

    expect(projectResponse.statusCode).toBe(404);
    expect(taskResponse.statusCode).toBe(404);
    expect(listTasks).not.toHaveBeenCalled();
    expect(taskResponse.json()).toEqual({ code: "TASK_NOT_FOUND", message: "Task not found" });
  });

  it("rejects invalid pagination before calling the provider", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?limit=0",
    });

    expect(response.statusCode).toBe(400);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("serves static assets and falls back to index.html for SPA routes", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "code-agent-web-"));
    await writeFile(join(staticRoot, "index.html"), "<main>CodeAgent Web</main>", "utf8");
    await writeFile(join(staticRoot, "app.js"), "export {};", "utf8");
    const app = await createCodeAgentServer({
      project,
      provider: createProvider().provider,
      staticRoot,
    });
    closeCallbacks.push(() => app.close());

    const routeResponse = await app.inject({ method: "GET", url: "/p/code-agent/t/task-1" });
    const assetResponse = await app.inject({ method: "GET", url: "/app.js" });
    const apiResponse = await app.inject({ method: "GET", url: "/v1/missing" });

    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.body).toContain("CodeAgent Web");
    expect(assetResponse.body).toBe("export {};");
    expect(apiResponse.statusCode).toBe(404);
    expect(apiResponse.headers["content-type"]).toContain("application/json");
  });
});
