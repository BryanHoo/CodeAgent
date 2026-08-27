import { useReducer, useState, type CSSProperties, type Dispatch, type PointerEvent } from "react";
import { Toaster } from "sonner";

import { ChatWorkspace } from "@/app/chat-workspace";
import { ProjectPanel } from "@/app/project-panel";
import { TaskSidebar } from "@/app/task-sidebar";
import { WorkbenchDialogs } from "@/app/workbench-dialogs";
import {
  INITIAL_WORKBENCH_STATE,
  reduceWorkbenchState,
  type WorkbenchAction,
} from "@/app/workbench-state";

type PanelName = "inspector" | "sidebar";
type ShellStyle = CSSProperties & {
  "--inspector-open-width": string;
  "--sidebar-open-width": string;
};

export function AppShell() {
  const [state, dispatch] = useReducer(reduceWorkbenchState, INITIAL_WORKBENCH_STATE);
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [inspectorWidth, setInspectorWidth] = useState(320);

  const startResize = (panel: PanelName, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === "sidebar" ? sidebarWidth : inspectorWidth;

    // 拖动期间直接按桌面指针位移计算，避免引入额外的布局观察器。
    const move = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.min(420, Math.max(240, startWidth + (panel === "sidebar" ? delta : -delta)));
      if (panel === "sidebar") setSidebarWidth(next);
      else setInspectorWidth(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const style: ShellStyle = {
    "--inspector-open-width": `${String(inspectorWidth)}px`,
    "--sidebar-open-width": `${String(sidebarWidth)}px`,
  };

  return (
    <div
      className="workbench-shell"
      data-inspector-open={state.inspectorOpen}
      data-sidebar-open={state.sidebarOpen}
      data-theme={state.theme}
      style={style}
    >
      <TaskSidebar dispatch={dispatch} state={state} />
      {state.sidebarOpen ? (
        <PanelResizer label="调整任务导航宽度" panel="sidebar" onPointerDown={startResize} />
      ) : null}
      <ChatWorkspace dispatch={dispatch} state={state} />
      {state.inspectorOpen ? (
        <PanelResizer label="调整检查器宽度" panel="inspector" onPointerDown={startResize} />
      ) : null}
      <ProjectPanel dispatch={dispatch} state={state} />
      <WorkbenchDialogs dispatch={dispatch} state={state} />
      <Toaster position="bottom-right" theme={state.theme} />
    </div>
  );
}

function PanelResizer({
  label,
  onPointerDown,
  panel,
}: Readonly<{
  label: string;
  onPointerDown: (panel: PanelName, event: PointerEvent<HTMLButtonElement>) => void;
  panel: PanelName;
}>) {
  return (
    <button
      aria-label={label}
      className={`workbench-panel-resizer workbench-panel-resizer--${panel}`}
      onPointerDown={(event) => onPointerDown(panel, event)}
      type="button"
    />
  );
}

export type WorkbenchDispatch = Dispatch<WorkbenchAction>;
