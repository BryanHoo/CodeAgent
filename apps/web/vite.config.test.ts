import { describe, expect, it } from "vitest";

import webConfig, { supportedBrowserTargets } from "./vite.config.js";

describe("Web Vite browser targets", () => {
  it("locks the production build to the supported browser minimums", () => {
    expect(supportedBrowserTargets).toEqual(["chrome116", "firefox124", "safari17.4"]);
    expect(webConfig).toMatchObject({
      build: { target: ["chrome116", "firefox124", "safari17.4"] },
    });
  });
});
