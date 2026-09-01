import { describe, expect, it } from "vitest";

import { NativeCommandError } from "../../../platform/tauri/native-client.js";
import {
  findUnsupportedInputModality,
  toPromptSubmissionError,
} from "./workbench-composer-submission.js";

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

describe("findUnsupportedInputModality", () => {
  it("uses model/list input modalities for structured media", () => {
    expect(
      findUnsupportedInputModality(
        [{ kind: "image", mediaType: "image/png", name: "diagram.png" }],
        ["text"],
      ),
    ).toBe("image");
    expect(
      findUnsupportedInputModality(
        [{ kind: "file", mediaType: "audio/mpeg", name: "recording.mp3" }],
        ["text", "image"],
      ),
    ).toBe("audio");
    expect(
      findUnsupportedInputModality(
        [{ kind: "file", mediaType: "application/pdf", name: "report.pdf" }],
        ["text"],
      ),
    ).toBeUndefined();
  });
});
