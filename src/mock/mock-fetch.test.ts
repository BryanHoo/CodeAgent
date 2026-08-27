import { describe, expect, it, vi } from "vitest";

import { createMockFetch } from "./mock-fetch.js";

describe("createMockFetch", () => {
  it("serves the workbench bootstrap without using the network", async () => {
    const networkFetch = vi.spyOn(globalThis, "fetch");
    const mockFetch = createMockFetch();

    const access = await mockFetch("/v1/access").then(async (response) => response.json());
    const projects = await mockFetch("/v1/projects").then(async (response) => response.json());

    expect(access).toMatchObject({ authenticated: true, mode: "local" });
    expect(projects).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ name: "CodeAgent" })]),
    });
    expect(networkFetch).not.toHaveBeenCalled();

    networkFetch.mockRestore();
  });

  it("supports diff, attachment and archive interactions locally", async () => {
    const mockFetch = createMockFetch();
    const diff = await mockFetch(
      "/v1/projects/codexly/git/commit-diff?rootPath=%2Fworkspace%2FCodeAgent&sha=1111111111111111111111111111111111111111&path=package.json",
    ).then(async (response) => response.json());

    const uploadBody = new FormData();
    uploadBody.set("attachment", new Blob(["mock"]), "notes.txt");
    const upload = await mockFetch("/v1/projects/codexly/attachments/file", {
      body: uploadBody,
      method: "POST",
    }).then(async (response) => response.json());

    await mockFetch("/v1/projects/codexly/tasks/input-design/archive", {
      body: "{}",
      method: "POST",
    });
    const archived = await mockFetch("/v1/projects/codexly/tasks?archived=true").then(
      async (response) => response.json(),
    );
    const restored = await mockFetch("/v1/projects/codexly/tasks/input-design/unarchive", {
      body: "{}",
      method: "POST",
    }).then(async (response) => response.json());

    expect(diff).toMatchObject({ diff: expect.stringContaining("@@ -1,3 +1,3 @@") });
    expect(upload).toMatchObject({ attachment: { kind: "file", name: "mock.txt" } });
    expect(archived).toMatchObject({ data: [expect.objectContaining({ id: "input-design" })] });
    expect(restored).toMatchObject({ task: expect.objectContaining({ id: "input-design" }) });
  });
});
