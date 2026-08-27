import { handleAppShellCoreRoute } from "./mock-core-route.js";
import { handleAppShellFallbackRoute } from "./mock-fallback-route.js";
import { handleAppShellProjectRoute } from "./mock-project-route.js";
import { MockRoute } from "./mock-route.js";
import { createAppShellApiState } from "./mock-state.js";
import { handleAppShellTaskRoute } from "./mock-task-route.js";

const mockOrigin = "http://codeagent.local";

async function normalizeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Readonly<{ body: string | null; method: string; url: string }>> {
  if (input instanceof Request) {
    const request = input.clone();
    return {
      body: request.method === "GET" || request.method === "HEAD" ? null : await request.text(),
      method: request.method,
      url: request.url,
    };
  }

  const url = new URL(String(input), mockOrigin).toString();
  const method = init?.method?.toUpperCase() ?? "GET";
  const body = typeof init?.body === "string" ? init.body : null;
  return { body, method, url };
}

export function createMockFetch(): typeof globalThis.fetch {
  const state = createAppShellApiState({ providerConnected: true });

  return async (input, init) => {
    const request = await normalizeRequest(input, init);
    const route = new MockRoute(request.url, request.method, request.body);

    if (await handleAppShellCoreRoute(route, state)) return route.response();
    if (await handleAppShellProjectRoute(route, state)) return route.response();
    if (await handleAppShellTaskRoute(route, state)) return route.response();
    if (await handleAppShellFallbackRoute(route, state)) return route.response();

    await route.fulfill({
      contentType: "application/json",
      json: { message: `Mock endpoint not implemented: ${request.method} ${request.url}` },
      status: 404,
    });
    return route.response();
  };
}
