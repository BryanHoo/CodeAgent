import { describe, expect, it } from "vitest";

import "../router.js";
import {
  projectSkillsMarketRoute,
  temporarySkillsMarketRoute,
} from "./skills-market-route.js";

describe("skills market routes", () => {
  it("keeps project and global market paths stable", () => {
    expect(projectSkillsMarketRoute.fullPath).toBe("/p/$projectId/skills");
    expect(temporarySkillsMarketRoute.fullPath).toBe("/temporary/skills");
  });
});
