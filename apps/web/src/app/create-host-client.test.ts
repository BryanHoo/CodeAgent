import { describe, expect, it } from "vitest";

import { CodeAgentClient } from "@code-agent/client";
import { codeAgentClient, createHostClient } from "./create-host-client.js";

describe("createHostClient", () => {
  it("creates the facade through the build-time host transport alias", () => {
    expect(createHostClient()).toBeInstanceOf(CodeAgentClient);
    expect(codeAgentClient).toBeInstanceOf(CodeAgentClient);
  });
});
