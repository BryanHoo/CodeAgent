import { expect, test } from "vitest";
import source from "./workbench-shell-active-task.tsx?raw";

test("mounts questions before the timeline in the central workbench", () => {
  expect(source.indexOf("<AsyncQuestionDock ")).toBeLessThan(source.indexOf("<TaskTimeline"));
});
