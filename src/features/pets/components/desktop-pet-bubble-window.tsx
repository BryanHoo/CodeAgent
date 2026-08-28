import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopPetState } from "../../../protocol/desktop-pet.js";
import {
  getDesktopPetState,
  layoutDesktopPetBubbles,
  listenDesktopPetState,
  openDesktopPetTask,
} from "../../../platform/tauri/desktop-pet-client.js";
import { WorkbenchPetBubbles } from "./workbench-pet-bubbles.js";

export function DesktopPetBubbleWindow() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DesktopPetState | null>(null);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listenDesktopPetState((nextState) => {
      if (!disposed) setState(nextState);
    })
      .then(async (unlisten) => {
        if (disposed) return unlisten();
        stopListening = unlisten;
        const initial = await getDesktopPetState();
        if (!disposed) setState(initial);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || state === null || state.tasks.length === 0) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      void layoutDesktopPetBubbles({
        height: Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height),
        width: Math.ceil(entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width),
      }).catch(() => undefined);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [state]);

  const handleTaskSelect = useCallback((projectId: string, taskId: string) => {
    void openDesktopPetTask({ projectId, taskId }).catch(() => undefined);
  }, []);

  if (state === null || state.tasks.length === 0) return null;
  return (
    <div className="desktop-pet-bubble-root" ref={rootRef}>
      <WorkbenchPetBubbles
        onTaskSelect={handleTaskSelect}
        tasks={state.tasks}
      />
    </div>
  );
}
