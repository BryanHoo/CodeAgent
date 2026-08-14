import { TEMPORARY_TASK_SCOPE_ID, type AgentTask } from "@code-agent/protocol";
import {
  Archive,
  CircleAlert,
  CircleCheck,
  Ellipsis,
  Pencil,
  Pin,
  ShieldQuestion,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { formatTaskAge } from "../../projects/project-data.js";
import type { TaskAttention } from "../../conversation/runtime/task-activity.js";

type TaskLinkProps = Readonly<{
  active: boolean;
  attention: TaskAttention;
  icon?: ReactNode;
  isActionPending: boolean;
  isRunning: boolean;
  onArchive: (task: AgentTask) => void;
  onPin: (task: AgentTask) => void;
  onRename: (task: AgentTask) => void;
  task: AgentTask;
}>;

export function getTaskRoute(projectId: string, taskId: string) {
  return projectId === TEMPORARY_TASK_SCOPE_ID
    ? { params: { taskId }, to: "/temporary/t/$taskId" as const }
    : { params: { projectId, taskId }, to: "/p/$projectId/t/$taskId" as const };
}

export function TaskLink({
  active,
  attention,
  icon,
  isActionPending,
  isRunning,
  onArchive,
  onPin,
  onRename,
  task,
}: TaskLinkProps) {
  const { t } = useTranslation("workbench");
  const taskRoute = getTaskRoute(task.projectId, task.id);

  return (
    <div className="group relative min-w-0">
      <Link
        aria-current={active ? "page" : undefined}
        className={`flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-body-small transition-colors ${
          active
            ? "bg-control-active font-medium text-foreground"
            : "text-muted-foreground hover:bg-control-hover hover:text-foreground"
        }`}
        {...taskRoute}
      >
        {icon === undefined ? null : (
          <span className="shrink-0 text-subtle-foreground">{icon}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        <TaskStatusIndicator
          attention={attention}
          isRunning={isRunning}
          updatedAt={task.updatedAt}
        />
      </Link>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-label={t("sidebar.openTaskActions", { task: task.title })}
            className="task-actions absolute right-1 top-1 grid size-6 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:opacity-100 focus-visible:shadow-focus"
            disabled={isActionPending}
            type="button"
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <TaskActionMenu
          isPending={isActionPending}
          onArchive={() => {
            onArchive(task);
          }}
          onPin={() => {
            onPin(task);
          }}
          onRename={() => {
            onRename(task);
          }}
          task={task}
        />
      </DropdownMenu>
    </div>
  );
}

type TaskStatusIndicatorProps = Readonly<{
  attention: TaskAttention;
  isRunning: boolean;
  updatedAt: string;
}>;

export function TaskStatusIndicator({ attention, isRunning, updatedAt }: TaskStatusIndicatorProps) {
  const { t } = useTranslation("workbench");
  if (attention === "approval") {
    return (
      <span
        aria-label={t("sidebar.taskApproval")}
        className="task-status ml-auto inline-flex shrink-0 text-brand"
        role="status"
      >
        <ShieldQuestion className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (isRunning) {
    return (
      <span
        aria-label={t("sidebar.taskRunning")}
        className="task-status ml-auto inline-flex shrink-0 text-subtle-foreground"
        role="status"
      >
        {/* 单元素透明度动画不旋转几何图形，降低多任务并行动画的合成压力。 */}
        <span className="sidebar-task-activity" aria-hidden="true" />
      </span>
    );
  }

  if (attention === "completed") {
    return (
      <span
        aria-label={t("sidebar.taskComplete")}
        className="task-status ml-auto inline-flex shrink-0 text-diff-added"
        role="status"
      >
        <CircleCheck className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (attention === "failed") {
    return (
      <span
        aria-label={t("sidebar.taskIncomplete")}
        className="task-status ml-auto inline-flex shrink-0 text-danger"
        role="status"
      >
        <CircleAlert className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="task-age task-status ml-auto shrink-0 text-caption text-subtle-foreground">
      {formatTaskAge(updatedAt)}
    </span>
  );
}

type TaskActionMenuProps = Readonly<{
  isPending: boolean;
  onArchive: () => void;
  onPin: () => void;
  onRename: () => void;
  task: AgentTask;
}>;

const taskActionClassName = "h-8 w-full text-left text-foreground";

export function TaskActionMenu({
  isPending,
  onArchive,
  onPin,
  onRename,
  task,
}: TaskActionMenuProps) {
  const { t } = useTranslation("workbench");
  return (
    <DropdownMenuContent
      align="start"
      aria-label={t("sidebar.taskActions", { task: task.title })}
      aria-labelledby={undefined}
      className="w-32"
    >
      <DropdownMenuItem className={taskActionClassName} disabled={isPending} onSelect={onPin}>
        <Pin className="size-3.5" aria-hidden="true" />
        {task.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
      </DropdownMenuItem>
      <DropdownMenuItem className={taskActionClassName} disabled={isPending} onSelect={onRename}>
        <Pencil className="size-3.5" aria-hidden="true" />
        {t("sidebar.rename")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={`${taskActionClassName} text-danger`}
        disabled={isPending}
        onSelect={onArchive}
      >
        <Archive className="size-3.5" aria-hidden="true" />
        {t("sidebar.archive")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
