import { describe, expect, it, vi } from "vitest";

import { TauriCatalogClient } from "./catalog-client.js";
import type { InvokeImplementation } from "./native-client.js";

describe("TauriCatalogClient skills market", () => {
  it("routes installed, browse, detail, toggle, and install commands", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriCatalogClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.listInstalledSkills();
    await client.openSkillDirectory("/skills/review/SKILL.md");
    await client.setSkillEnabled("/skills/review/SKILL.md", false);
    await client.listClawhubSkills("review", null, "recommended");
    await client.getClawhubSkill("codex", "review");
    await client.installClawhubSkill("codex", "review", "project", "project-a", "/work");

    expect(invoke.mock.calls).toEqual([
      [
        "list_installed_skills",
        { forceReload: false },
      ],
      ["open_skill_directory", { path: "/skills/review/SKILL.md" }],
      ["set_skill_enabled", { enabled: false, path: "/skills/review/SKILL.md" }],
      ["list_clawhub_skills", { cursor: null, query: "review", sort: "recommended" }],
      ["get_clawhub_skill", { owner: "codex", slug: "review" }],
      [
        "install_clawhub_skill",
        {
          owner: "codex",
          projectId: "project-a",
          rootPath: "/work",
          scope: "project",
          slug: "review",
        },
      ],
    ]);
  });
});
