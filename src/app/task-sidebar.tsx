import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  MessageSquareTextIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { WorkbenchDispatch } from "@/app/app-shell";
import { ALL_TASKS, PROJECTS, type WorkbenchTask } from "@/app/workbench-data";
import type { WorkbenchState } from "@/app/workbench-state";
import { Button } from "@/components/ui/button";

type TaskSidebarProps = Readonly<{ dispatch: WorkbenchDispatch; state: WorkbenchState }>;

export function TaskSidebar({ dispatch, state }: TaskSidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(["codeagent", "superwork"]),
  );
  const normalizedQuery = state.searchQuery.trim().toLocaleLowerCase();
  const visibleTaskIds = useMemo(
    () =>
      new Set(
        ALL_TASKS.filter((task) => task.title.toLocaleLowerCase().includes(normalizedQuery)).map(
          (task) => task.id,
        ),
      ),
    [normalizedQuery],
  );

  const toggleProject = (projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <aside className="workbench-sidebar" id="task-sidebar" aria-label="任务导航">
      <header className="sidebar-brand-row">
        <img alt="CodeAgent" height="28" src="/brand/codeagent-logo.svg" width="124" />
      </header>

      <nav aria-label="Agent 导航" className="sidebar-primary-nav">
        <label className="sidebar-search">
          <SearchIcon aria-hidden="true" />
          <input
            aria-label="搜索任务"
            onChange={(event) => dispatch({ query: event.currentTarget.value, type: "setSearch" })}
            placeholder="搜索任务"
            value={state.searchQuery}
          />
          <kbd>⌘ K</kbd>
        </label>
        <button className="sidebar-new-task" onClick={() => dispatch({ taskId: "draft", type: "selectTask" })} type="button">
          <SendIcon aria-hidden="true" /><span>新建任务</span><kbd>⌘ N</kbd>
        </button>
      </nav>

      <div className="sidebar-tree-scroll">
        {normalizedQuery.length === 0 ? (
          <section className="sidebar-section" aria-labelledby="pinned-heading">
            <h2 id="pinned-heading">已固定</h2>
            {ALL_TASKS.filter((task) => task.pinned === true).map((task) => (
              <TaskRow
                dispatch={dispatch}
                key={`pinned:${task.id}`}
                selected={state.selectedTaskId === task.id}
                task={task}
                withPin
              />
            ))}
          </section>
        ) : null}

        <section className="sidebar-section project-tree" aria-labelledby="projects-heading">
          <div className="sidebar-section-heading">
            <h2 id="projects-heading">项目</h2>
            <Button aria-label="添加项目" onClick={() => dispatch({ dialog: "project", type: "openDialog" })} size="icon" title="添加项目" variant="ghost"><PlusIcon aria-hidden="true" /></Button>
          </div>
          <ProjectHeading expanded onClick={() => undefined} name="临时任务" temporary />
          <div className="project-task-list">
            <button className={state.selectedTaskId === "draft" ? "sidebar-task-row active" : "sidebar-task-row"} onClick={() => dispatch({ taskId: "draft", type: "selectTask" })} type="button"><MessageSquareTextIcon aria-hidden="true" /><span>新任务草稿</span></button>
          </div>

          {PROJECTS.map((project) => {
            const expanded = expandedProjects.has(project.id);
            const tasks = project.tasks.filter((task) => visibleTaskIds.has(task.id));
            if (normalizedQuery.length > 0 && tasks.length === 0) return null;
            return (
              <div className="project-group" key={project.id}>
                <ProjectHeading expanded={expanded} name={project.name} onClick={() => toggleProject(project.id)} />
                {expanded ? (
                  <div className="project-task-list">
                    {tasks.map((task) => (
                      <TaskRow
                        dispatch={dispatch}
                        key={task.id}
                        selected={state.selectedTaskId === task.id}
                        task={task}
                      />
                    ))}
                    {tasks.length === 0 ? <p className="sidebar-empty">暂无任务</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </div>

      <footer className="sidebar-footer">
        <button onClick={() => dispatch({ dialog: "settings", type: "openDialog" })} type="button"><Settings2Icon aria-hidden="true" /><span>设置</span><small>v0.1.0 · <i className="connection-dot" /> 在线</small></button>
      </footer>
    </aside>
  );
}

function ProjectHeading({
  expanded,
  name,
  onClick,
  temporary = false,
}: Readonly<{ expanded: boolean; name: string; onClick: () => void; temporary?: boolean }>) {
  return (
    <div className="project-heading-row">
      <button aria-expanded={expanded} onClick={onClick} type="button">
        {expanded ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
        {temporary ? <MessageSquareTextIcon aria-hidden="true" /> : <FolderIcon aria-hidden="true" />}
        <span>{name}</span>
      </button>
      <Button aria-label={`在 ${name} 中新建任务`} size="icon" title="新建任务" variant="ghost"><PlusIcon aria-hidden="true" /></Button>
    </div>
  );
}

function TaskRow({
  dispatch,
  selected,
  task,
  withPin = false,
}: Readonly<{
  dispatch: WorkbenchDispatch;
  selected: boolean;
  task: WorkbenchTask;
  withPin?: boolean;
}>) {
  return (
    <div className="sidebar-task-wrap">
      <button
        aria-current={selected ? "page" : undefined}
        className={selected ? "sidebar-task-row active" : "sidebar-task-row"}
        onClick={() => dispatch({ taskId: task.id, type: "selectTask" })}
        type="button"
      >
        {withPin ? <PinIcon aria-hidden="true" /> : null}
        <span>{task.title}</span>
        <span className={`task-status task-status--${task.status}`} title={task.status} />
        <time>{task.time}</time>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><Button aria-label={`打开任务操作：${task.title}`} className="task-action-trigger" size="icon" variant="ghost"><EllipsisIcon aria-hidden="true" /></Button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content align="end" className="task-action-menu" sideOffset={3}>
          <DropdownMenu.Item onSelect={() => dispatch({ dialog: "task", type: "openDialog" })}><PencilIcon aria-hidden="true" />重命名</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => toast.success(task.pinned === true ? "已取消固定任务" : "已固定任务")}><PinIcon aria-hidden="true" />{task.pinned === true ? "取消固定" : "固定"}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => dispatch({ dialog: "archived", type: "openDialog" })}><ArchiveIcon aria-hidden="true" />归档</DropdownMenu.Item>
          <DropdownMenu.Item className="danger" onSelect={() => toast.info("前端演示不会删除本地任务")}><Trash2Icon aria-hidden="true" />删除</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
