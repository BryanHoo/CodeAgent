import type {
  AgentContextUsage,
  AgentModel,
  AgentReviewTarget,
  AgentSkill,
  AgentTaskSettings,
  ProjectGitStatus,
} from "@code-agent/protocol";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type {
  PromptInputAttachment,
  PromptInputAttachmentKind,
  PromptInputMessage,
} from "../../../shared/ai-elements/prompt-input.js";
import type { QueuedComposerPrompt } from "../composer-draft-context.js";
import type { ComposerState, ComposerSubmitAction } from "../composer-state.js";
import type { PromptCommandItem } from "./prompt-command.js";
import type { PromptSkillContent, PromptSkillEditorHandle } from "./prompt-skill-editor.js";

export type CommandAvailability = Readonly<{ available: boolean; reason?: string }>;

export type WorkbenchComposerViewProps = Readonly<{
  activeCommandIndex: number;
  activeCommandItemId: string | undefined;
  activeSettings: AgentTaskSettings;
  activeTurnId: string | undefined;
  attachments: readonly PromptInputAttachment[];
  attachmentsDisabled: boolean;
  baseBranches: readonly string[];
  canInterrupt: boolean;
  canSteer: boolean;
  canSubmit: boolean;
  commandMenuId: string;
  commandMenuOpen: boolean;
  commandNotice: string | undefined;
  commandSurfaceRef: RefObject<HTMLDivElement | null>;
  composerScope: string;
  contextUsage: AgentContextUsage | null | undefined;
  draftInputDisabled: boolean;
  filteredCommands: readonly PromptCommandItem[];
  filteredSkills: readonly AgentSkill[];
  getCommandAvailability: (command: PromptCommandItem) => CommandAvailability;
  gitStatus: ProjectGitStatus | undefined;
  hasComposerInput: boolean;
  isSubmitting: boolean;
  menuItemCount: number;
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  mutationError: Error | null;
  onAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  onExecuteCommand: (command: PromptCommandItem) => void;
  onExecuteReview: (target: AgentReviewTarget) => void;
  onInterrupt: () => void;
  onOpenReviewBranches: () => void;
  onPlanModeRemove: () => void;
  onPromptChange: (
    content: PromptSkillContent,
    serializedText: string,
    cursorOffset: number,
  ) => void;
  onSelectActiveCommand: () => void;
  onSelectAttachmentKind: (kind: PromptInputAttachmentKind) => void;
  onSelectSkill: (skill: AgentSkill) => void;
  onSettingsChange: (settings: AgentTaskSettings, field: keyof AgentTaskSettings) => void;
  onSubmit: (message: PromptInputMessage) => void;
  onViewError: (error: Error) => void;
  projectPath: string;
  planModeEnabled: boolean;
  promptContent: PromptSkillContent;
  promptSubmissionText: string;
  queuedPrompts: readonly QueuedComposerPrompt[];
  removeQueuedPrompt: (queuedPromptId: string) => void;
  reviewMenuMode: "branches" | "scopes" | null;
  selectedModel: AgentModel | undefined;
  selectedReasoningEffort: string | undefined;
  setActiveCommandIndex: Dispatch<SetStateAction<number>>;
  skillEditorRef: RefObject<PromptSkillEditorHandle | null>;
  state: ComposerState;
  steerQueuedPrompt: (queuedPrompt: QueuedComposerPrompt) => void;
  submitAction: ComposerSubmitAction;
  taskId: string | undefined;
  turnControlsDisabled: boolean;
}>;

export function resolveQueuedPromptSummary(
  queuedPrompt: QueuedComposerPrompt,
  attachmentSummary: string,
): string {
  return (
    queuedPrompt.text ||
    queuedPrompt.skills.map((skill) => `$${skill.name}`).join(" ") ||
    attachmentSummary
  );
}
