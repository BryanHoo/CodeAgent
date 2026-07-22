import type { AgentTask, Project } from "@code-agent/protocol";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { createProjectId, initialProjects, initialTasks } from "./project-data.js";

type DirectoryHandle = Readonly<{
  kind: "directory";
  name: string;
}>;

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryHandle>;
};

type ProjectContextValue = Readonly<{
  addProjectFromDirectory: () => Promise<Project>;
  projects: readonly Project[];
  tasks: readonly AgentTask[];
}>;

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

async function pickProjectDirectory() {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (picker === undefined) {
    throw new Error("当前浏览器不支持选择项目文件夹");
  }
  return picker.call(window);
}

type ProjectProviderProps = Readonly<{
  children: ReactNode;
}>;

export function ProjectProvider({ children }: ProjectProviderProps) {
  const [projects, setProjects] = useState<readonly Project[]>(initialProjects);
  const [tasks] = useState<readonly AgentTask[]>(initialTasks);

  const addProjectFromDirectory = useCallback(async () => {
    const directory = await pickProjectDirectory();
    const project: Project = {
      createdAt: new Date().toISOString(),
      id: createProjectId(
        directory.name,
        projects.map((item) => item.id),
      ),
      name: directory.name,
    };

    // 目录句柄和绝对路径不进入页面状态，后续由本地 Runtime 完成注册与授权。
    setProjects((current) => [...current, project]);
    return project;
  }, [projects]);

  const value = useMemo(
    () => ({ addProjectFromDirectory, projects, tasks }),
    [addProjectFromDirectory, projects, tasks],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProjects must be used inside ProjectProvider");
  }
  return context;
}
