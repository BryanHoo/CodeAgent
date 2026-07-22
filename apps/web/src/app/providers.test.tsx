import { describe, expect, it } from "vitest";

import { createAppQueryClient } from "./providers.js";

describe("createAppQueryClient", () => {
  it("uses stable defaults for a local long-running project", () => {
    const queryClient = createAppQueryClient();
    const queryDefaults = queryClient.getDefaultOptions().queries;

    expect(queryDefaults?.retry).toBe(1);
    expect(queryDefaults?.staleTime).toBe(30_000);
    expect(queryDefaults?.refetchOnWindowFocus).toBe(false);
  });
});
