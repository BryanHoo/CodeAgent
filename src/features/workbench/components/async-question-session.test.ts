import { expect, test } from "vitest";
import { createQuestionDraftStore, dismissQuestion, saveQuestionDraft, type QuestionDraft } from "./async-question-session.js";

const draft: QuestionDraft = { answers: [{ choice: null, text: "answer" }], status: "editing", error: false };

test("dismisses untouched questions and preserves existing drafts without marking them sent", () => {
  const store = createQuestionDraftStore();
  dismissQuestion(store, "untouched");
  expect(store.getState().drafts.get("untouched")?.status).toBe("dismissed");
  saveQuestionDraft(store, "draft", draft);
  dismissQuestion(store, "draft");
  expect(store.getState().drafts.get("draft")).toEqual({ ...draft, status: "dismissed" });
});

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
