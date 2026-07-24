import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  PanelLeftClose,
  Pin,
  Search,
  Send,
  Settings,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatTaskAge, getPinnedTasks } from "../../projects/project-data.js";
import { useProjects } from "../../projects/project-context.js";
import { IconButton } from "../../../shared/ui/icon-button.js";

const primaryActionClassName =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small font-medium text-foreground transition-colors hover:bg-control-hover";
const primaryActionIconClassName = "size-4 shrink-0 text-muted-foreground";

type ProjectSidebarProps = Readonly<{
  onClose: () => void;
  projectId: string;
  taskId?: string;
}>;

export function ProjectSidebar({ onClose, projectId, taskId }: ProjectSidebarProps) {
  const { error, isPending, projects, tasks } = useProjects();
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(projects.map((project) => project.id)),
  );
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleTasks = useMemo(
    () =>
      normalizedQuery.length === 0
        ? tasks
        : tasks.filter((task) => task.title.toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery, tasks],
  );
  const pinnedTasks = getPinnedTasks(visibleTasks);

  useEffect(() => {
    // Projects 异步到达后默认展开新项目，保留用户已手动设置的现有项目状态。
    setExpandedProjects((current) => {
      const next = new Set(current);
      let changed = false;
      for (const project of projects) {
        if (!next.has(project.id)) {
          next.add(project.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [projects]);

  const toggleProject = (id: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <aside
      aria-label="Project Sidebar"
      className="workbench-sidebar z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-sidebar shadow-divider"
    >
      <div className="flex h-workbench-header items-center gap-2 px-3">
        <Link
          aria-label="CodeAgent 首页"
          className="flex min-w-0 flex-1 items-center gap-2 text-body-small font-semibold text-foreground"
          params={{ projectId }}
          to="/p/$projectId"
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-control bg-foreground text-caption font-bold text-raised shadow-sm"
          >
            CA
          </span>
          <span className="truncate">CodeAgent</span>
        </Link>
        <IconButton
          className="min-workbench:hidden"
          label="关闭项目侧栏"
          onClick={onClose}
          size="small"
        >
          <PanelLeftClose className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>

      <nav className="space-y-0.5 px-2" aria-label="Agent 导航">
        <div className="relative px-1 pb-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
          />
          <input
            aria-label="搜索任务"
            className="h-9 w-full rounded-control bg-control pl-8 pr-2.5 text-body-small text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:shadow-focus"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder="搜索任务"
            value={query}
          />
        </div>
        <Link className={primaryActionClassName} params={{ projectId }} to="/p/$projectId">
          <Send className={primaryActionIconClassName} aria-hidden="true" />
          新建任务
        </Link>
      </nav>

      <div className="min-h-0 overflow-y-auto px-2 pb-3 pt-5">
        {pinnedTasks.length > 0 ? (
          <section className="mb-6" aria-labelledby="pinned-title">
            <h2
              className="px-2 pb-2 text-meta font-semibold text-muted-foreground"
              id="pinned-title"
            >
              Pinned
            </h2>
            <div className="space-y-0.5">
              {pinnedTasks.map((task) => (
                <TaskLink
                  active={task.id === taskId}
                  icon={<Pin className="size-3.5" aria-hidden="true" />}
                  key={task.id}
                  task={task}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="projects-title">
          <div className="mb-2 flex h-7 w-full items-center">
            <h2 className="text-meta font-semibold text-muted-foreground" id="projects-title">
              Projects
            </h2>
          </div>

          {isPending ? (
            <p className="px-2 py-1.5 text-meta text-subtle-foreground">正在加载任务</p>
          ) : null}
          {error === null ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              无法加载任务
            </p>
          )}

          <div className="space-y-4">
            {projects.map((project) => {
              const projectTasks = visibleTasks.filter((task) => task.projectId === project.id);
              const expanded = expandedProjects.has(project.id);

              return (
                <div key={project.id}>
                  <div className="flex min-w-0 items-center gap-0.5">
                    <button
                      aria-expanded={expanded}
                      aria-label={`切换项目 ${project.name}`}
                      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-body-small font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
                      onClick={() => {
                        toggleProject(project.id);
                      }}
                      type="button"
                    >
                      <Folder className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <IconButton
                      label={expanded ? `收起项目 ${project.name}` : `展开项目 ${project.name}`}
                      onClick={() => {
                        toggleProject(project.id);
                      }}
                      size="small"
                    >
                      {expanded ? (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      )}
                    </IconButton>
                  </div>

                  {expanded ? (
                    <div className="mt-0.5 space-y-0.5 pl-5">
                      {projectTasks.map((task) => (
                        <TaskLink active={task.id === taskId} key={task.id} task={task} />
                      ))}
                      {projectTasks.length === 0 && normalizedQuery.length === 0 ? (
                        <p className="px-2 py-1.5 text-meta text-subtle-foreground">暂无任务</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="p-2">
        <Link
          aria-label="设置"
          className="flex h-9 items-center gap-2.5 rounded-control px-2.5 text-body-small text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
          to="/settings"
        >
          <Settings className="size-4" aria-hidden="true" />
          Settings
          <span className="ml-auto inline-flex items-center gap-1 text-caption">
            <WifiOff className="size-3" aria-hidden="true" /> Offline
          </span>
        </Link>
      </div>
    </aside>
  );
}

type TaskLinkProps = Readonly<{
  active: boolean;
  icon?: React.ReactNode;
  task: ReturnType<typeof getPinnedTasks>[number];
}>;

function TaskLink({ active, icon, task }: TaskLinkProps) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-body-small transition-colors ${
        active
          ? "bg-control-active font-medium text-foreground"
          : "text-muted-foreground hover:bg-control-hover hover:text-foreground"
      }`}
      params={{ projectId: task.projectId, taskId: task.id }}
      to="/p/$projectId/t/$taskId"
    >
      {icon === undefined ? null : <span className="shrink-0 text-subtle-foreground">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="shrink-0 text-caption text-subtle-foreground">
        {formatTaskAge(task.updatedAt)}
      </span>
    </Link>
  );
}
