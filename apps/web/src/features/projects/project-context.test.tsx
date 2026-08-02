import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buildProjectTaskCollections, useProjectData } from "./project-context.js";

const projects = [
  {
    createdAt: "2026-08-02T00:00:00.000Z",
    id: "project-1",
    name: "Project 1",
    rootPath: "/workspace/project-1",
  },
  {
    createdAt: "2026-08-02T00:00:00.000Z",
    id: "project-2",
    name: "Project 2",
    rootPath: "/workspace/project-2",
  },
] as const;

describe("Project Context", () => {
  it("builds task collections only for queried projects", () => {
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "project-1",
      title: "拆分 Context",
      updatedAt: "2026-08-02T00:01:00.000Z",
    } as const;
    const projectTaskResults = new Map([
      [
        "project-1",
        {
          controller: { fetchNextPage: vi.fn(() => Promise.resolve()) },
          state: {
            error: null,
            hasNextPage: true,
            isFetchingNextPage: false,
            isPending: false,
          },
          tasks: [task],
        },
      ],
    ]);

    const result = buildProjectTaskCollections(projects, projectTaskResults);

    expect(result.tasks).toEqual([task]);
    expect(result.projectTaskStates.get("project-1")).toEqual(
      projectTaskResults.get("project-1")?.state,
    );
    expect(result.projectTaskStates.get("project-2")).toMatchObject({
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      isPending: true,
    });
  });

  it("requires the dedicated data provider", () => {
    function DataConsumer() {
      useProjectData();
      return null;
    }

    expect(() => renderToStaticMarkup(<DataConsumer />)).toThrow(
      "useProjectData must be used inside ProjectProvider",
    );
  });
});
