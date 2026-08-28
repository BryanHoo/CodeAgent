import type { DesktopPetState } from "../../../protocol/desktop-pet.js";
import type { WorkbenchPetSettings } from "../../../protocol/index.js";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import {
  listenDesktopPetTaskOpen,
  syncDesktopPet,
} from "../../../platform/tauri/desktop-pet-client.js";
import { useProjectActivity, useProjectData } from "../../projects/project-context.js";
import { resolveDesktopPetState } from "../desktop-pet-state.js";
import { deriveWorkbenchPetActivity } from "../pet-activity.js";
import { petCatalogQueryOptions } from "../pet-catalog-query.js";

function DesktopPetSync({ state }: Readonly<{ state: DesktopPetState | null }>) {
  useEffect(() => {
    // 主窗口只同步最小状态，宠物资源和动画均由独立窗口本地处理。
    void syncDesktopPet(state).catch(() => undefined);
  }, [state]);
  return null;
}

function EnabledDesktopPet({ settings }: Readonly<{ settings: WorkbenchPetSettings }>) {
  const { projects, tasks } = useProjectData();
  const { taskActivity } = useProjectActivity();
  const navigate = useNavigate();
  const catalog = useQuery(petCatalogQueryOptions());
  const activity = useMemo(
    () => deriveWorkbenchPetActivity(projects, tasks, taskActivity),
    [projects, taskActivity, tasks],
  );
  const state = useMemo(
    () => resolveDesktopPetState(settings, activity, catalog.data?.data ?? []),
    [activity, catalog.data?.data, settings],
  );

  useEffect(() => {
    let stopListening: (() => void) | undefined;
    void listenDesktopPetTaskOpen(({ projectId, taskId }) => {
      void navigate({ params: { projectId, taskId }, to: "/p/$projectId/t/$taskId" });
    }).then((unlisten) => {
      stopListening = unlisten;
    });
    return () => {
      stopListening?.();
    };
  }, [navigate]);
  return <DesktopPetSync state={state} />;
}

export function WorkbenchPetLayer({
  settings,
}: Readonly<{ settings: WorkbenchPetSettings | undefined }>) {
  if (settings?.enabled !== true) return <DesktopPetSync state={null} />;
  return <EnabledDesktopPet settings={settings} />;
}
