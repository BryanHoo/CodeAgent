import { describe, expect, it } from "vitest";

import { resolveDesktopPetState } from "./desktop-pet-state.js";

describe("resolveDesktopPetState", () => {
  it("returns a native state only for an enabled downloaded pet", () => {
    expect(
      resolveDesktopPetState(
        { enabled: true, selectedPetId: "codex" },
        {
          animationName: "waiting",
          tasks: [
            {
              projectId: "project-1",
              rootPath: "/workspace",
              status: "waiting",
              taskId: "task-1",
              taskName: "Review change",
            },
          ],
        },
        [{ availability: "ready", id: "codex" }],
      ),
    ).toEqual({
      animationName: "waiting",
      petId: "codex",
      tasks: [
        {
          projectId: "project-1",
          rootPath: "/workspace",
          status: "waiting",
          taskId: "task-1",
          taskName: "Review change",
        },
      ],
    });
    expect(
      resolveDesktopPetState(
        { enabled: true, selectedPetId: "codex" },
        { animationName: "waiting", tasks: [] },
        [{ availability: "downloadable", id: "codex" }],
      ),
    ).toBeNull();
    expect(
      resolveDesktopPetState(
        { enabled: false, selectedPetId: null },
        { animationName: "waiting", tasks: [] },
        [],
      ),
    ).toBeNull();
  });
});
