import { describe, expect, it } from "vitest";

import {
  CodexProtocolMappingError,
  mapAgentModel,
  mapSandboxMode,
} from "./codex-protocol-mapping.js";

describe("Codex protocol mapping", () => {
  it("maps supported sandbox modes and rejects unknown values", () => {
    expect(mapSandboxMode("read-only")).toBe("read-only");
    expect(mapSandboxMode("workspace-write")).toBe("workspace-write");
    expect(mapSandboxMode("danger-full-access")).toBe("danger-full-access");
    expect(() => mapSandboxMode("legacy-mode")).toThrow(CodexProtocolMappingError);
  });

  it("filters hidden models while preserving the supported effort catalog", () => {
    expect(
      mapAgentModel({
        defaultReasoningEffort: "high",
        description: "Test model",
        displayName: "GPT Test",
        hidden: false,
        isDefault: true,
        model: "gpt-test",
        supportedReasoningEfforts: [{ description: "Deep reasoning", reasoningEffort: "high" }],
      }),
    ).toMatchObject({
      defaultReasoningEffort: "high",
      displayName: "GPT Test",
      id: "gpt-test",
      isDefault: true,
    });
    expect(mapAgentModel({ hidden: true })).toBeUndefined();
  });
});
