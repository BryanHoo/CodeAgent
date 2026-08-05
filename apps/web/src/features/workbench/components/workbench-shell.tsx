import { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellLayout } from "./workbench-shell-layout.js";
import { useWorkbenchShellRuntime, type WorkbenchShellProps } from "./workbench-shell-runtime.js";

export { loadProjectSourceDialog } from "./workbench-shell-runtime.js";

export function WorkbenchShell({ projectId, taskId }: WorkbenchShellProps) {
  const taskScope = taskId === undefined ? { projectId } : { projectId, taskId };
  const shell = useWorkbenchShellRuntime(taskScope);
  const context = useWorkbenchShellController(shell, taskScope);
  return <WorkbenchShellLayout context={context} {...taskScope} />;
}
