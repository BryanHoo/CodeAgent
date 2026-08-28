import type { DesktopPetState } from "../../protocol/desktop-pet.js";
import type { WorkbenchPetDescriptor, WorkbenchPetSettings } from "../../protocol/index.js";
import type { WorkbenchPetActivity } from "./pet-activity.js";

export function resolveDesktopPetState(
  settings: WorkbenchPetSettings | undefined,
  activity: WorkbenchPetActivity,
  pets: readonly Pick<WorkbenchPetDescriptor, "availability" | "id">[],
): DesktopPetState | null {
  if (settings?.enabled !== true) return null;
  const available = pets.some(
    (pet) => pet.id === settings.selectedPetId && pet.availability === "ready",
  );
  return available
    ? {
        animationName: activity.animationName,
        petId: settings.selectedPetId,
        tasks: [...activity.tasks],
      }
    : null;
}
