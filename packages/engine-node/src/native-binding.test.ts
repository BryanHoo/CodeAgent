import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  NativeBindingLoadError,
  loadNativeBinding,
  resolveDevelopmentAddonPaths,
  resolveNativeBindingPackage,
} from "./native-binding.js";

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

  it.each([
    ["darwin", "arm64", "@bryanhu/code-agent-darwin-arm64"],
    ["linux", "x64", "@bryanhu/code-agent-linux-x64-gnu"],
    ["win32", "x64", "@bryanhu/code-agent-win32-x64-msvc"],
  ] as const)("maps %s-%s to %s", (platform, arch, expected) => {
    expect(resolveNativeBindingPackage(platform, arch)).toBe(expected);
  });

  it("rejects unsupported targets before loading a module", () => {
    expect(() => resolveNativeBindingPackage("darwin", "x64")).toThrow(
      "不支持 native addon 平台: darwin-x64",
    );
    expect(() => resolveNativeBindingPackage("linux", "riscv64")).toThrow(
      "不支持 native addon 平台: linux-riscv64",
    );
  });

  it("loads the exact platform package without scanning directories", () => {
    const NodeEngine = Object.assign(() => undefined, {
      open: () => Promise.reject(new Error("unused")),
    });
    const binding = {
      NodeEngine,
      addonVersion: () => "test",
    };
    const load = vi.fn(() => binding);

    expect(loadNativeBinding({ arch: "arm64", load, platform: "darwin" })).toBe(binding);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith("@bryanhu/code-agent-darwin-arm64");
  });

  it("resolves the workspace addon from the bundled CLI location", () => {
    const paths = resolveDevelopmentAddonPaths(
      pathToFileURL(resolve("workspace/apps/node-cli/dist/chunk.js")),
    );

    expect(paths).toContain(
      resolve("workspace/packages/engine-node/native/code-agent-node-binding.node"),
    );
  });
});
