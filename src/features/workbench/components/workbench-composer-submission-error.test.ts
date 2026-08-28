import { describe, expect, it } from "vitest";

import { NativeCommandError } from "../../../platform/tauri/native-client.js";
import { toPromptSubmissionError } from "./workbench-composer-submission.js";

describe("toPromptSubmissionError", () => {
  it("maps a busy Codex thread to an actionable localized message", () => {
    const error = toPromptSubmissionError(
      new NativeCommandError(
        "CODEX_THREAD_BUSY",
        "Codex thread is active in another session",
      ),
      (key) => (key === "composer.threadBusy" ? "该任务正在另一个 Codex 会话中运行" : key),
    );

    expect(error.message).toBe("该任务正在另一个 Codex 会话中运行");
  });

  it("preserves ordinary Error instances", () => {
    const source = new Error("request timeout");

    expect(toPromptSubmissionError(source, (key) => key)).toBe(source);
  });
});
