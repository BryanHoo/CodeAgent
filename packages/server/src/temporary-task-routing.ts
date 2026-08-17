import {
  TEMPORARY_TASK_API_PATH,
  TEMPORARY_TASK_SANDBOX_MODE,
  TEMPORARY_TASK_SCOPE_ID,
  type AgentTaskSettings,
} from "@code-agent/protocol";

export function enforceTemporaryTaskSandboxMode(
  projectId: string,
  settings: AgentTaskSettings,
): AgentTaskSettings {
  if (
    projectId !== TEMPORARY_TASK_SCOPE_ID ||
    settings.sandboxMode === TEMPORARY_TASK_SANDBOX_MODE
  ) {
    return settings;
  }
  // 临时 Task 对用户隐藏内部工作区，因此沙盒能力只能使用固定的完全访问模式。
  return { ...settings, sandboxMode: TEMPORARY_TASK_SANDBOX_MODE };
}

export function rewriteTemporaryTaskUrl(url: string): string {
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex < 0 ? url : url.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : url.slice(queryIndex);
  if (!pathname.startsWith(TEMPORARY_TASK_API_PATH)) {
    return url;
  }
  const suffix = pathname.slice(TEMPORARY_TASK_API_PATH.length);
  const taskRoute = suffix === "/tasks" || suffix.startsWith("/tasks/");
  const attachmentRoute = suffix.startsWith("/attachments/");
  const streamedFileRoute = suffix === "/files/image" || suffix === "/files/source";
  const hostOpenRoute = suffix === "/open" || suffix === "/open-capabilities";
  if (
    !taskRoute &&
    !attachmentRoute &&
    !streamedFileRoute &&
    !hostOpenRoute &&
    suffix !== "/events" &&
    suffix !== "/skills"
  ) {
    return url;
  }
  return `/v1/projects/${TEMPORARY_TASK_SCOPE_ID}${suffix}${query}`;
}
