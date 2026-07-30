import type { ProjectOpenApp, ProjectOpenAppId } from "@code-agent/protocol";

const projectOpenAppStorageKey = "code-agent:project-open:app:v1";

export type ProjectOpenPreferenceStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

type ProjectOpenPreference = Readonly<{
  appIdsByProject: Readonly<Record<string, string>>;
  version: 1;
}>;

export function getProjectOpenPreferenceStorage(): ProjectOpenPreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // 浏览器禁用存储时仍允许当前会话选择和打开应用。
    return undefined;
  }
}

function readPreference(
  storage: ProjectOpenPreferenceStorage | undefined,
): ProjectOpenPreference | undefined {
  if (storage === undefined) {
    return undefined;
  }
  try {
    const serialized = storage.getItem(projectOpenAppStorageKey);
    if (serialized === null) {
      return undefined;
    }
    const preference: unknown = JSON.parse(serialized);
    if (!isProjectOpenPreference(preference)) {
      return undefined;
    }
    return preference;
  } catch {
    return undefined;
  }
}

export function readProjectOpenAppId(
  storage: ProjectOpenPreferenceStorage | undefined,
  projectId: string,
  apps: readonly ProjectOpenApp[],
): ProjectOpenAppId | undefined {
  const savedAppId = readPreference(storage)?.appIdsByProject[projectId];
  return apps.find((app) => app.id === savedAppId)?.id;
}

export function resolveProjectOpenAppId(
  storage: ProjectOpenPreferenceStorage | undefined,
  projectId: string,
  apps: readonly ProjectOpenApp[],
  defaultOpenAppId: ProjectOpenAppId | null | undefined,
): ProjectOpenAppId | undefined {
  return (
    readProjectOpenAppId(storage, projectId, apps) ??
    apps.find((app) => app.id === defaultOpenAppId)?.id ??
    apps[0]?.id
  );
}

export function writeProjectOpenAppId(
  storage: ProjectOpenPreferenceStorage | undefined,
  projectId: string,
  appId: ProjectOpenAppId,
): void {
  if (storage === undefined) {
    return;
  }
  const current = readPreference(storage);
  const preference: ProjectOpenPreference = {
    appIdsByProject: { ...current?.appIdsByProject, [projectId]: appId },
    version: 1,
  };
  try {
    storage.setItem(projectOpenAppStorageKey, JSON.stringify(preference));
  } catch {
    // 配额或隐私模式写入失败时保留当前组件内的即时选择。
  }
}

function isProjectOpenPreference(value: unknown): value is ProjectOpenPreference {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const appIdsByProject = candidate["appIdsByProject"];
  return (
    candidate["version"] === 1 &&
    typeof appIdsByProject === "object" &&
    appIdsByProject !== null &&
    Object.values(appIdsByProject).every((appId) => typeof appId === "string")
  );
}
