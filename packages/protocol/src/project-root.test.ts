import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import { ProjectRootQuerySchema, ProjectRootSchema, ProjectRootsSchema } from "./project-root.js";

describe("project root protocol", () => {
  it("accepts ordered absolute roots and rejects empty, relative, or duplicated roots", () => {
    const roots = [{ path: "/workspace/primary" }, { path: "/workspace/secondary" }];

    expect(Value.Check(ProjectRootsSchema, roots)).toBe(true);
    expect(Value.Check(ProjectRootsSchema, [])).toBe(false);
    expect(Value.Check(ProjectRootsSchema, [{ path: "workspace/relative" }])).toBe(false);
    expect(Value.Check(ProjectRootsSchema, [roots[0], roots[0]])).toBe(false);
    expect(Value.Check(ProjectRootSchema, { extra: true, path: "/workspace/primary" })).toBe(false);
  });

  it("requires an absolute root path for public root-scoped requests", () => {
    expect(Value.Check(ProjectRootQuerySchema, { rootPath: "/workspace/primary" })).toBe(true);
    expect(Value.Check(ProjectRootQuerySchema, {})).toBe(false);
    expect(Value.Check(ProjectRootQuerySchema, { rootPath: "workspace/primary" })).toBe(false);
  });
});
