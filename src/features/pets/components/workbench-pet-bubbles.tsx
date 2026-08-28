import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import type { DesktopPetTask } from "../../../protocol/desktop-pet.js";

function compareBubblePriority(left: DesktopPetTask, right: DesktopPetTask): number {
  if (left.status === right.status) return 0;
  if (left.status === "completed") return -1;
  if (right.status === "completed") return 1;
  return 0;
}

function TaskBubble({
  activity,
  localAccess,
  onTaskSelect,
}: Readonly<{
  activity: DesktopPetTask;
  localAccess: boolean;
  onTaskSelect: (projectId: string, taskId: string) => void;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <button
      aria-label={t("pet.openTask", {
        name: activity.taskName,
        status: t(`pet.status.${activity.status}`),
      })}
      className="workbench-pet-bubble-button"
      onClick={() => {
        onTaskSelect(activity.projectId, activity.taskId);
      }}
      title={localAccess ? activity.rootPath : undefined}
      type="button"
    >
      {activity.status === "waiting" ? (
        <CircleAlert aria-hidden="true" className="desktop-pet-bubble-icon text-warning" />
      ) : activity.status === "completed" ? (
        <CircleCheck aria-hidden="true" className="desktop-pet-bubble-icon text-task-completed" />
      ) : (
        <LoaderCircle
          aria-hidden="true"
          className="desktop-pet-bubble-icon text-brand motion-safe:animate-spin"
        />
      )}
      <span>{activity.taskName}</span>
    </button>
  );
}

export function WorkbenchPetBubbles({
  localAccess,
  onTaskSelect,
  tasks,
}: Readonly<{
  localAccess: boolean;
  onTaskSelect: (projectId: string, taskId: string) => void;
  tasks: readonly DesktopPetTask[];
}>) {
  const { t } = useTranslation("workbench");
  if (tasks.length === 0) return null;
  const waitingCount = tasks.filter((activity) => activity.status === "waiting").length;
  // 完成提醒在折叠态置于最高层，其余气泡保持原有顺序。
  const orderedTasks = tasks.toSorted(compareBubblePriority);
  return (
    <div className="workbench-pet-bubbles">
      <span aria-live="polite" className="sr-only">
        {t("pet.activitySummary", { count: tasks.length, waiting: waitingCount })}
      </span>
      <ol aria-label={t("pet.activeTasks")} className="workbench-pet-bubble-list">
        {orderedTasks.map((activity, index) => (
          <li
            className="workbench-pet-bubble-item"
            key={`${activity.projectId}:${activity.taskId}`}
            style={{ zIndex: orderedTasks.length - index }}
          >
            <TaskBubble activity={activity} localAccess={localAccess} onTaskSelect={onTaskSelect} />
          </li>
        ))}
      </ol>
    </div>
  );
}
