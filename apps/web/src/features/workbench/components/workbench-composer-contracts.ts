import type {
  AgentAttachment,
  AgentCapabilities,
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentSandboxMode,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
  AgentTurn,
  AgentTurnOptions,
  ProjectGitStatus,
} from "@code-agent/protocol";
import type { Ref } from "react";

import type {
  BrowserPromptInputAttachment,
  PromptInputAttachment,
} from "../../../shared/ai-elements/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { CodeAgentMutationClient } from "../../projects/project-queries.js";
import type { CodeAgentGitMutationClient } from "../../projects/project-query-contracts.js";

export type ComposerMode = "goal" | "plan";

export function createComposerTurnOptions(
  settings: AgentTaskSettings,
  model: string,
  reasoningEffort: string | undefined,
  mode: ComposerMode | undefined,
): AgentTurnOptions {
  return {
    ...settings,
    ...(mode === "plan" ? { collaborationMode: "plan" as const } : {}),
    ...(mode === "goal" ? { goalMode: true as const } : {}),
    model,
    reasoningEffort: reasoningEffort ?? settings.reasoningEffort,
  };
}

export type WorkbenchComposerHandle = Readonly<{
  buildPlan: () => Promise<boolean>;
}>;

export type WorkbenchComposerProps = Readonly<{
  buildPlanRef?: Ref<WorkbenchComposerHandle>;
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentMutationClient & Pick<CodeAgentGitMutationClient, "switchProjectBranch">;
  fixedSandboxMode?: AgentSandboxMode;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onSettingsChange: (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
  ) => Promise<void> | void;
  onRequestNotificationPermission: () => void;
  onOpenGitHistory: () => void;
  onDirectSubmission?: () => void;
  onSubmissionStateChange?: (submitting: boolean) => void;
  onTaskCreated?: (task: AgentTask) => void;
  onTurnStarted?: (
    turn: AgentTurn,
    input: AgentPromptInput,
    messageAttachments: readonly AgentMessageAttachment[],
  ) => void;
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
    messageAttachments?: readonly AgentMessageAttachment[],
  ) => void;
  projectId: string;
  projectPath: string;
  projectToolsEnabled?: boolean;
  gitStatus?: ProjectGitStatus;
  runtime?: TaskRuntimeView;
  settings: AgentTaskSettings;
  skills: readonly AgentSkill[];
  taskId?: string;
}>;

export async function resolvePromptAttachment(
  attachment: PromptInputAttachment,
  uploadBrowserAttachment: (attachment: BrowserPromptInputAttachment) => Promise<AgentAttachment>,
): Promise<AgentAttachment> {
  if (attachment.source === "host") {
    return attachment.attachment;
  }
  return uploadBrowserAttachment(attachment);
}
