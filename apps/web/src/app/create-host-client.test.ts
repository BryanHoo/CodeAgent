import { describe, expect, it } from "vitest";

import { CodeAgentClient } from "@code-agent/client";
import { createHostExternalUrlApi, createHostNotificationApi } from "@code-agent/host-transport";
import {
  codeAgentClient,
  createHostClient,
  hostExternalUrlApi,
  hostNotificationApi,
} from "./create-host-client.js";

describe("createHostClient", () => {
  it("creates the facade through the build-time host transport alias", () => {
    expect(createHostClient()).toBeInstanceOf(CodeAgentClient);
    expect(codeAgentClient).toBeInstanceOf(CodeAgentClient);
  });

  it("does not expose a native notification adapter in the Web build", () => {
    expect(createHostNotificationApi(codeAgentClient)).toBeUndefined();
    expect(hostNotificationApi).toBeUndefined();
  });

  it("does not expose a native external URL adapter in the Web build", () => {
    expect(createHostExternalUrlApi()).toBeUndefined();
    expect(hostExternalUrlApi).toBeUndefined();
  });
});
