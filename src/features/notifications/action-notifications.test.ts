import { describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { NativeCommandError } from "../../platform/tauri/native-client.js";
import { actionErrorMessage } from "./action-notifications.js";

describe("actionErrorMessage", () => {
  it.each([
    ["FILE_OPEN_TARGET_UNAVAILABLE", "fileOpenTargetUnavailable"],
    ["FILE_OPEN_APPLICATION_FAILED", "fileOpenApplicationFailed"],
  ] as const)("localizes %s", (code, key) => {
    expect(actionErrorMessage(new NativeCommandError(code, "backend fallback"))).toBe(
      i18n.t(`errors.${key}`, { ns: "common" }),
    );
  });
  it("localizes the missing Git dependency error", () => {
    const error = new NativeCommandError("GIT_NOT_FOUND", "backend fallback");

    expect(actionErrorMessage(error)).toBe(i18n.t("errors.gitNotFound", { ns: "common" }));
  });

  it("localizes attachment size errors", () => {
    const error = new NativeCommandError("ATTACHMENT_TOO_LARGE", "backend fallback");

    expect(actionErrorMessage(error)).toBe(
      i18n.t("errors.attachmentTooLarge", { ns: "common" }),
    );
  });

  it("shows the Codex RPC error message", () => {
    const error = new NativeCommandError(
      "CODEX_RPC_ERROR",
      "invalid value: expected TOML value",
      -32600,
    );

    expect(actionErrorMessage(error)).toBe("invalid value: expected TOML value");
  });
});
