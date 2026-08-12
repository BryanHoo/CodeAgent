import { describe, expect, it, vi } from "vitest";

import { NativeBindingLoadError, loadNativeBinding } from "./native-binding.js";

describe("loadNativeBinding", () => {
  it("returns an injected binding without touching the filesystem", () => {
    const binding = {
      NodeEngine: { open: () => Promise.reject(new Error("unused")) },
      addonVersion: () => "test",
    };
    const load = vi.fn();

    expect(loadNativeBinding({ binding, load })).toBe(binding);
    expect(load).not.toHaveBeenCalled();
  });

  it("reports the resolved addon path when loading fails", () => {
    const cause = new Error("invalid native module");

    expect(() =>
      loadNativeBinding({
        addonPath: "/opt/code-agent/code-agent-node-binding.node",
        load: () => {
          throw cause;
        },
      }),
    ).toThrow(NativeBindingLoadError);

    try {
      loadNativeBinding({
        addonPath: "/opt/code-agent/code-agent-node-binding.node",
        load: () => {
          throw cause;
        },
      });
    } catch (error) {
      expect(error).toMatchObject({
        addonPath: "/opt/code-agent/code-agent-node-binding.node",
        cause,
        code: "NATIVE_BINDING_LOAD_FAILED",
      });
    }
  });
});
