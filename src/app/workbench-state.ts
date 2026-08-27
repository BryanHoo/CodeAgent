export type InspectorTab = "project" | "changes" | "context" | "history";
export type WorkbenchDialog = "archived" | "project" | "settings" | "task" | null;
export type WorkbenchTheme = "dark" | "light";

export type WorkbenchState = Readonly<{
  dialog: WorkbenchDialog;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  searchQuery: string;
  selectedTaskId: string;
  sidebarOpen: boolean;
  theme: WorkbenchTheme;
}>;

export type WorkbenchAction =
  | Readonly<{ type: "closeDialog" }>
  | Readonly<{ dialog: Exclude<WorkbenchDialog, null>; type: "openDialog" }>
  | Readonly<{ tab: InspectorTab; type: "selectInspectorTab" }>
  | Readonly<{ taskId: string; type: "selectTask" }>
  | Readonly<{ query: string; type: "setSearch" }>
  | Readonly<{ type: "toggleInspector" }>
  | Readonly<{ type: "toggleSidebar" }>
  | Readonly<{ type: "toggleTheme" }>;

export const INITIAL_WORKBENCH_STATE: WorkbenchState = {
  dialog: null,
  inspectorOpen: true,
  inspectorTab: "project",
  searchQuery: "",
  selectedTaskId: "draft",
  sidebarOpen: true,
  theme: "light",
};

export function reduceWorkbenchState(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case "closeDialog":
      return { ...state, dialog: null };
    case "openDialog":
      return { ...state, dialog: action.dialog };
    case "selectInspectorTab":
      return { ...state, inspectorTab: action.tab };
    case "selectTask":
      return {
        ...state,
        inspectorTab: action.taskId === "draft" ? "project" : "context",
        selectedTaskId: action.taskId,
      };
    case "setSearch":
      return { ...state, searchQuery: action.query };
    case "toggleInspector":
      return { ...state, inspectorOpen: !state.inspectorOpen };
    case "toggleSidebar":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "toggleTheme":
      return { ...state, theme: state.theme === "light" ? "dark" : "light" };
    default:
      return state;
  }
}
