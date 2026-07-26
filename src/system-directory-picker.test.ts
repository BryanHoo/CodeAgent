import { describe, expect, it, vi } from "vitest";

import { selectSystemDirectory } from "./system-directory-picker.js";

describe("selectSystemDirectory", () => {
  it("uses the macOS folder chooser and returns its selected path", async () => {
    const execute = vi.fn(() =>
      Promise.resolve({ stderr: "", stdout: "/Users/example/Workspace\n" }),
    );

    await expect(selectSystemDirectory({ execute, platform: "darwin" })).resolves.toBe(
      "/Users/example/Workspace",
    );
    expect(execute).toHaveBeenCalledWith("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "选择项目文件夹")',
    ]);
  });

  it("returns undefined when the user cancels the chooser", async () => {
    const error = Object.assign(new Error("cancelled"), { code: 1 });

    await expect(
      selectSystemDirectory({
        execute: vi.fn(() => Promise.reject(error)),
        platform: "linux",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects unsupported host platforms", async () => {
    await expect(selectSystemDirectory({ execute: vi.fn(), platform: "freebsd" })).rejects.toThrow(
      "Unsupported directory picker platform: freebsd",
    );
  });
});
