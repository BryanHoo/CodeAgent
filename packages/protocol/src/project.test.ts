import { describe, expect, it } from "vitest";

import { AgentTaskSchema, ProjectSchema } from "./project.js";

describe("project protocol", () => {
  it("defines a public project without exposing its local path", () => {
    expect(ProjectSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        createdAt: { format: "date-time", type: "string" },
        id: { minLength: 1, type: "string" },
        name: { minLength: 1, type: "string" },
      },
      required: ["id", "name", "createdAt"],
      type: "object",
    });
    expect(ProjectSchema.properties).not.toHaveProperty("path");
  });

  it("scopes every task to a project and records its pinned state", () => {
    expect(AgentTaskSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { minLength: 1, type: "string" },
        pinned: { type: "boolean" },
        projectId: { minLength: 1, type: "string" },
        title: { minLength: 1, type: "string" },
        updatedAt: { format: "date-time", type: "string" },
      },
      required: ["id", "projectId", "title", "updatedAt", "pinned"],
      type: "object",
    });
  });
});
