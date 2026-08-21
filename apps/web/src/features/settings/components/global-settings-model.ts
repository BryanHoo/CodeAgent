import {
  DEFAULT_COMMIT_MESSAGE_MODEL,
  type AgentGlobalSettings,
  type AgentModel,
  type AgentProjectDefaults,
} from "@code-agent/protocol";

import { readThemePreference, type ThemePreference } from "../theme-preference.js";

export type ApprovalMode = AgentGlobalSettings["approvalPolicy"] | "auto-review";

export function resolveGlobalSettingsModel(
  models: readonly AgentModel[],
  modelId: string,
  requestedEffort: string,
): Pick<AgentProjectDefaults, "model" | "reasoningEffort"> {
  const model = models.find((item) => item.id === modelId);
  if (model === undefined) {
    return { model: modelId, reasoningEffort: requestedEffort };
  }
  const reasoningEffort = model.supportedReasoningEfforts.some(
    (effort) => effort.id === requestedEffort,
  )
    ? requestedEffort
    : model.defaultReasoningEffort;
  return { model: model.id, reasoningEffort };
}

export function deriveApprovalMode(settings: AgentGlobalSettings): ApprovalMode {
  return settings.approvalsReviewer === "auto_review" ? "auto-review" : settings.approvalPolicy;
}

export function applyApprovalMode(
  settings: AgentGlobalSettings,
  mode: ApprovalMode,
): AgentGlobalSettings {
  // 自动审批由 on-request 与 auto_review 共同表达，不能映射为权限更宽的 never。
  return mode === "auto-review"
    ? { ...settings, approvalPolicy: "on-request", approvalsReviewer: "auto_review" }
    : { ...settings, approvalPolicy: mode, approvalsReviewer: "user" };
}

export function createFallbackSettings(models: readonly AgentModel[]): AgentGlobalSettings {
  const model = models.find((item) => item.isDefault) ?? models[0];
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    commitMessageModel: DEFAULT_COMMIT_MESSAGE_MODEL,
    commitMessagePrompt: "",
    defaultOpenAppId: null,
    fastMode: false,
    followUpBehavior: "queue",
    model: model?.id ?? "",
    reasoningEffort: model?.defaultReasoningEffort ?? "",
    sandboxMode: "workspace-write",
  };
}

export function readInitialTheme(): ThemePreference {
  return typeof window === "undefined" ? "system" : readThemePreference(window.localStorage);
}
