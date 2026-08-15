import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getErrorMessage, showErrorToast } from "./error-toast.js";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("error toast", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it("preserves third-party error messages exactly", () => {
    const error = Object.assign(new Error("remote: permission denied\nfatal: push rejected"), {
      code: "PROVIDER_FAILURE",
    });

    showErrorToast(error);

    expect(toast.error).toHaveBeenCalledWith("remote: permission denied\nfatal: push rejected");
  });

  it("deduplicates the same error object across global and local handlers", () => {
    const error = new Error("Codex connection closed");

    showErrorToast(error);
    showErrorToast(error);

    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("reads structured transport messages without rewriting them", () => {
    expect(getErrorMessage({ message: "mcp server failed" })).toBe("mcp server failed");
  });
});
