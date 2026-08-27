import { useState } from "react";

import { ChatWorkspace } from "@/app/chat-workspace";
import { ProjectPanel } from "@/app/project-panel";
import { TaskSidebar } from "@/app/task-sidebar";
import { cn } from "@/lib/cn";

export function AppShell() {
  // 面板状态由外壳统一管理，确保中栏工具栏始终保留恢复入口。
  const [isTaskSidebarOpen, setIsTaskSidebarOpen] = useState(true);
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(true);

  return (
    <div
      className={cn(
        "app-shell",
        !isTaskSidebarOpen && "app-shell-task-collapsed",
        !isProjectPanelOpen && "app-shell-project-collapsed",
      )}
    >
      {isTaskSidebarOpen && <TaskSidebar />}
      <ChatWorkspace
        isProjectPanelOpen={isProjectPanelOpen}
        isTaskSidebarOpen={isTaskSidebarOpen}
        onToggleProjectPanel={() => setIsProjectPanelOpen((isOpen) => !isOpen)}
        onToggleTaskSidebar={() => setIsTaskSidebarOpen((isOpen) => !isOpen)}
      />
      {isProjectPanelOpen && <ProjectPanel />}
    </div>
  );
}
