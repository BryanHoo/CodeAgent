import { expect, test } from "vitest";
import { createQuestionDraftStore, saveQuestionDraft, type QuestionDraft } from "./async-question-session.js";

const draft: QuestionDraft = { answers: [{ choice: null, text: "answer" }], status: "editing", error: false };

test("bounds session drafts while retaining sending and recently edited questions", () => {
  const store = createQuestionDraftStore();
  saveQuestionDraft(store, "pending", { ...draft, status: "sending" });
  for (let index = 0; index < 127; index++) saveQuestionDraft(store, `${index}`, draft);
  saveQuestionDraft(store, "0", draft);
  saveQuestionDraft(store, "new", draft);
  expect(store.getState().drafts.size).toBe(128);
  expect(store.getState().drafts.has("pending")).toBe(true);
  expect(store.getState().drafts.has("0")).toBe(true);
  expect(store.getState().drafts.has("1")).toBe(false);
});
