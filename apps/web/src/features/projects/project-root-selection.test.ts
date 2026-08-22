import { describe, expect, it } from "vitest";

import { resolveSelectedProjectRoot, setProjectRootPathChecked } from "./project-root-selection.js";

const project = {
  id: "project-1",
  roots: [{ path: "/workspace/primary" }, { path: "/workspace/secondary" }],
} as const;

describe("project root selection", () => {
  it("defaults to the primary root and keeps a valid secondary selection", () => {
    expect(resolveSelectedProjectRoot(project, undefined)?.path).toBe("/workspace/primary");
    expect(
      resolveSelectedProjectRoot(project, {
        path: "/workspace/secondary",
        projectId: "project-1",
      })?.path,
    ).toBe("/workspace/secondary");
  });

  it("falls back when the project or selected root changes", () => {
    expect(
      resolveSelectedProjectRoot(project, {
        path: "/workspace/missing",
        projectId: "project-1",
      })?.path,
    ).toBe("/workspace/primary");
    expect(
      resolveSelectedProjectRoot(project, {
        path: "/workspace/secondary",
        projectId: "another-project",
      })?.path,
    ).toBe("/workspace/primary");
  });

  it("builds an ordered root list from checkbox changes", () => {
    const selected = setProjectRootPathChecked([], "/workspace/primary", true);
    const aggregated = setProjectRootPathChecked(selected, "/workspace/secondary", true);

    expect(aggregated).toEqual(["/workspace/primary", "/workspace/secondary"]);
    expect(setProjectRootPathChecked(aggregated, "/workspace/primary", false)).toEqual([
      "/workspace/secondary",
    ]);
    expect(setProjectRootPathChecked(aggregated, "/workspace/primary", true)).toBe(aggregated);
  });
});
