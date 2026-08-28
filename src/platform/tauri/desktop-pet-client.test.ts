import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("desktop pet native client", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("synchronizes the selected pet and activity animation", async () => {
    const { syncDesktopPet } = await import("./desktop-pet-client.js");
    const state = {
      animationName: "running" as const,
      localAccess: false,
      petId: "codex",
      tasks: [],
    };

    await syncDesktopPet(state);

    expect(invoke).toHaveBeenCalledWith("sync_desktop_pet", { state });
  });

  it("destroys the native pet window when the feature is disabled", async () => {
    const { syncDesktopPet } = await import("./desktop-pet-client.js");

    await syncDesktopPet(null);

    expect(invoke).toHaveBeenCalledWith("sync_desktop_pet", { state: null });
  });

  it("uses the native drag session when the runtime can report its release", async () => {
    invoke.mockResolvedValueOnce("native");
    const { getDesktopPetDragStrategy, startDesktopPetNativeDrag } = await import(
      "./desktop-pet-client.js"
    );

    await expect(getDesktopPetDragStrategy()).resolves.toBe("native");
    await startDesktopPetNativeDrag();

    expect(invoke).toHaveBeenNthCalledWith(1, "get_desktop_pet_drag_strategy");
    expect(invoke).toHaveBeenNthCalledWith(2, "start_desktop_pet_native_drag");
  });

  it("keeps frame-coalesced positioning as the non-native fallback", async () => {
    const { setDesktopPetDragPosition } = await import("./desktop-pet-client.js");

    await setDesktopPetDragPosition({ x: 320, y: 480 });

    expect(invoke).toHaveBeenCalledWith("set_desktop_pet_drag_position", { x: 320, y: 480 });
  });

  it("moves the native window for keyboard interaction", async () => {
    const { moveDesktopPet } = await import("./desktop-pet-client.js");

    await moveDesktopPet({ deltaX: -24, deltaY: 0, reset: false });

    expect(invoke).toHaveBeenCalledWith("move_desktop_pet", {
      deltaX: -24,
      deltaY: 0,
      reset: false,
    });
  });

  it("sizes the companion bubble window to its rendered content", async () => {
    const { layoutDesktopPetBubbles } = await import("./desktop-pet-client.js");

    await layoutDesktopPetBubbles({ height: 96, width: 192 });

    expect(invoke).toHaveBeenCalledWith("layout_desktop_pet_bubbles", {
      height: 96,
      width: 192,
    });
  });

  it("asks the main window to open a task selected from a bubble", async () => {
    const { openDesktopPetTask } = await import("./desktop-pet-client.js");

    await openDesktopPetTask({ projectId: "project-1", taskId: "task-1" });

    expect(invoke).toHaveBeenCalledWith("open_desktop_pet_task", {
      projectId: "project-1",
      taskId: "task-1",
    });
  });
});
