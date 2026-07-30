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
    const error = Object.assign(new Error("cancelled"), { code: 1, stderr: "" });

    await expect(
      selectSystemDirectory({
        execute: vi.fn(() => Promise.reject(error)),
        platform: "linux",
      }),
    ).resolves.toBeUndefined();
  });

  it("recognizes native macOS and Windows cancellation results", async () => {
    const macCancellation = Object.assign(new Error("User canceled"), {
      code: 1,
      stderr: "execution error: User canceled. (-128)",
    });
    const windowsCancellation = Object.assign(new Error("cancelled"), { code: 2, stderr: "" });

    await expect(
      selectSystemDirectory({
        execute: vi.fn(() => Promise.reject(macCancellation)),
        platform: "darwin",
      }),
    ).resolves.toBeUndefined();
    await expect(
      selectSystemDirectory({
        execute: vi.fn(() => Promise.reject(windowsCancellation)),
        platform: "win32",
      }),
    ).resolves.toBeUndefined();
  });

  it("falls back to kdialog when zenity is not installed", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("spawn zenity ENOENT"), { code: "ENOENT" }))
      .mockResolvedValueOnce({ stderr: "", stdout: "/home/example/Workspace\n" });

    await expect(selectSystemDirectory({ execute, platform: "linux" })).resolves.toBe(
      "/home/example/Workspace",
    );
    expect(execute).toHaveBeenNthCalledWith(2, "kdialog", [
      "--getexistingdirectory",
      ".",
      "--title",
      "选择项目文件夹",
    ]);
  });

  it("falls back to terminal input when Linux GUI pickers are unavailable", async () => {
    const execute = vi.fn(() =>
      Promise.reject(Object.assign(new Error("not found"), { code: "ENOENT" })),
    );
    const prompt = vi.fn(() => Promise.resolve("/srv/CodeAgent"));

    await expect(selectSystemDirectory({ execute, platform: "linux", prompt })).resolves.toBe(
      "/srv/CodeAgent",
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("reports missing GUI pickers when terminal input is unavailable", async () => {
    const execute = vi.fn(() =>
      Promise.reject(Object.assign(new Error("not found"), { code: "ENOENT" })),
    );

    await expect(
      selectSystemDirectory({
        execute,
        platform: "linux",
        prompt: vi.fn(() => Promise.resolve(undefined)),
      }),
    ).rejects.toThrow("No supported directory picker is installed");
  });

  it("does not treat picker failures as user cancellation", async () => {
    const error = Object.assign(new Error("display unavailable"), {
      code: 1,
      stderr: "cannot open display",
    });

    await expect(
      selectSystemDirectory({ execute: vi.fn(() => Promise.reject(error)), platform: "linux" }),
    ).rejects.toThrow("display unavailable");
  });

  it("forces UTF-8 output for Windows paths", async () => {
    const execute = vi.fn(() =>
      Promise.resolve({ stderr: "", stdout: "C:\\用户\\代码\\CodeAgent\r\n" }),
    );

    await expect(selectSystemDirectory({ execute, platform: "win32" })).resolves.toBe(
      "C:\\用户\\代码\\CodeAgent",
    );
    expect(execute).toHaveBeenCalledWith("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-Command",
      expect.stringContaining(
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      ),
    ]);
  });

  it("rejects unsupported host platforms", async () => {
    await expect(selectSystemDirectory({ execute: vi.fn(), platform: "freebsd" })).rejects.toThrow(
      "Unsupported directory picker platform: freebsd",
    );
  });
});
