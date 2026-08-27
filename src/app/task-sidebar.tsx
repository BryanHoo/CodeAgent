import {
  FolderIcon,
  MessageSquareTextIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const PINNED_TASKS = [
  { title: "根据 Codex 官方文档完善工作台布局", time: "1d" },
  { title: "阅读项目结构并整理组件规范", time: "1d" },
];

const PROJECTS = [
  {
    name: "CodeAgent",
    sessions: [
      { title: "实现 Codex 风格工作台界面", time: "2m", active: true },
      { title: "梳理 Tauri 桌面端工程结构", time: "9m" },
      { title: "优化前端状态管理与类型定义", time: "1h" },
    ],
  },
  {
    name: "superwork",
    sessions: [
      { title: "更新技能路由和执行规范", time: "2h" },
      { title: "补充工作流校验文档", time: "3h" },
    ],
  },
  { name: "FeedFuse", sessions: [] },
  { name: "demo-page", sessions: [] },
];

export function TaskSidebar() {
  return (
    <aside className="task-sidebar" id="task-sidebar" aria-label="任务导航">
      <div className="sidebar-topbar">
        <div className="app-brand">
          <span className="brand-symbol" aria-hidden="true">
            <i>&gt;</i>_
          </span>
          <strong>CodeAgent</strong>
        </div>
      </div>

      <div className="sidebar-actions">
        <label className="search-control">
          <SearchIcon aria-hidden="true" />
          <input aria-label="搜索任务" placeholder="搜索任务" readOnly />
          <kbd>⌘ K</kbd>
        </label>
        <button className="new-task-control" type="button">
          <SendIcon aria-hidden="true" />
          <span>新建任务</span>
          <kbd>⌘ N</kbd>
        </button>
      </div>

      <div className="sidebar-scroll-area">
        <section className="task-section" aria-labelledby="pinned-heading">
          <h2 id="pinned-heading">已固定</h2>
          <div className="task-list">
            {PINNED_TASKS.map((task) => (
              <button className="task-row" key={task.title} type="button">
                <PinIcon aria-hidden="true" />
                <span>{task.title}</span>
                <time>{task.time}</time>
              </button>
            ))}
          </div>
        </section>

        <section className="task-section project-section" aria-labelledby="projects-heading">
          <div className="section-heading-row">
            <h2 id="projects-heading">项目</h2>
            <Button aria-label="添加项目" title="添加项目" size="icon" variant="ghost">
              <PlusIcon aria-hidden="true" />
            </Button>
          </div>

          <button className="task-row temporary-row" type="button">
            <MessageSquareTextIcon aria-hidden="true" />
            <span>临时任务</span>
          </button>

          <div className="project-list">
            {PROJECTS.map((project) => (
              <div className="project-group" key={project.name}>
                <button className="project-name" type="button">
                  <FolderIcon aria-hidden="true" />
                  <span>{project.name}</span>
                </button>
                {project.sessions.map((session) => (
                  <button
                    className={`session-row${session.active ? " session-row-active" : ""}`}
                    key={session.title}
                    type="button"
                  >
                    <span>{session.title}</span>
                    <time>{session.time}</time>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="sidebar-footer">
        <button className="settings-control" type="button">
          <Settings2Icon aria-hidden="true" />
          <span>设置</span>
          <span className="version-number">v0.6.0</span>
        </button>
      </footer>
    </aside>
  );
}
