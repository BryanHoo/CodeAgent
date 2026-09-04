import { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellLayout } from "./workbench-shell-layout.js";
import { useWorkbenchShellRuntime, type WorkbenchShellProps } from "./workbench-shell-runtime.js";

export function WorkbenchShell({
  board = false,
  draftId,
  projectId,
  skillsMarket = false,
  taskId,
  temporary = false,
}: WorkbenchShellProps) {
  const taskScope = taskId === undefined ? { projectId } : { projectId, taskId };
  const shell = useWorkbenchShellRuntime({ ...taskScope, temporary });
  const context = useWorkbenchShellController(shell, { ...taskScope, temporary });
  return (
    <WorkbenchShellLayout
      board={board}
      skillsMarket={skillsMarket}
      context={context}
      {...(draftId === undefined ? {} : { draftId })}
      {...taskScope}
      temporary={temporary}
    />
  );
}
