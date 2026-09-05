import type { WorkbenchComposerHandle } from "./workbench-composer-contracts.js";
import type { createComposerSubmission } from "./workbench-composer-submission.js";

export function createComposerHandle({
  activeTurnId, buildPlanPrompt, clearMode, referenceProjectPath, submitCurrent, submitPrompt,
}: Readonly<{
  activeTurnId: string | undefined;
  buildPlanPrompt: string;
  clearMode: () => void;
  referenceProjectPath: WorkbenchComposerHandle["referenceProjectPath"];
  submitCurrent: WorkbenchComposerHandle["submitCurrent"];
  submitPrompt: ReturnType<typeof createComposerSubmission>;
}>): WorkbenchComposerHandle {
  return {
    answerQuestions: (text) => submitPrompt({ files: [], text }, [], {
      // 问题回答复用提交锁，但不清空草稿、不继承计划或 Goal 模式，也不排队。
      clearInputOnSuccess: false,
      composerMode: null,
      forceAction: activeTurnId === undefined ? "start" : "steer",
    }),
    buildPlan: () => {
      clearMode();
      return submitPrompt({ files: [], text: buildPlanPrompt }, [], {
        composerMode: null, forceAction: "start",
      });
    },
    referenceProjectPath,
    submitCurrent,
  };
}
