import { describe, expect, it } from "vitest";

import {
  AGENT_FILE_EXTENSIONS,
  isAgentTextFileName,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_TEXT_BYTES,
} from "./agent-attachments.js";

describe("Codex 0.151 attachment contract", () => {
  it("accepts bounded text inputs and excludes unsupported binary documents", () => {
    expect(MAX_AGENT_FILE_BYTES).toBe(MAX_AGENT_TEXT_BYTES);
    expect(AGENT_FILE_EXTENSIONS).toContain(".md");
    expect(AGENT_FILE_EXTENSIONS).not.toContain(".pdf");
    expect(AGENT_FILE_EXTENSIONS).not.toContain(".docx");
    expect(AGENT_FILE_EXTENSIONS).not.toContain(".xlsx");
    expect(isAgentTextFileName("notes.MD")).toBe(true);
    expect(isAgentTextFileName("document.pdf")).toBe(false);
  });
});
