import {
  DEFAULT_AGENT_GRANULAR_APPROVAL_POLICY,
  type AgentApprovalsReviewer,
  type AgentGranularApprovalConfig,
  type AgentTurnApprovalPolicy,
} from "@code-agent/protocol";

type ApprovalSettings = Readonly<{
  approvalPolicy: AgentTurnApprovalPolicy;
  approvalsReviewer: AgentApprovalsReviewer;
}>;

export type GlobalApprovalMode =
  "auto-review" | "granular" | "granular-auto-review" | "never" | "on-request";
export type TurnApprovalMode = GlobalApprovalMode | "untrusted";

export function isGranularApprovalPolicy(
  policy: AgentTurnApprovalPolicy,
): policy is Readonly<{ granular: AgentGranularApprovalConfig }> {
  return typeof policy === "object";
}

export function deriveApprovalMode(settings: ApprovalSettings): TurnApprovalMode {
  if (isGranularApprovalPolicy(settings.approvalPolicy)) {
    return settings.approvalsReviewer === "auto_review" ? "granular-auto-review" : "granular";
  }
  return settings.approvalPolicy === "on-request" && settings.approvalsReviewer === "auto_review"
    ? "auto-review"
    : settings.approvalPolicy;
}

export function applyApprovalMode<T extends ApprovalSettings>(
  settings: T,
  mode: TurnApprovalMode,
): T {
  const currentGranular = isGranularApprovalPolicy(settings.approvalPolicy)
    ? settings.approvalPolicy
    : DEFAULT_AGENT_GRANULAR_APPROVAL_POLICY;
  if (mode === "granular" || mode === "granular-auto-review") {
    return {
      ...settings,
      approvalPolicy: currentGranular,
      approvalsReviewer: mode === "granular-auto-review" ? "auto_review" : "user",
    };
  }
  return mode === "auto-review"
    ? { ...settings, approvalPolicy: "on-request", approvalsReviewer: "auto_review" }
    : { ...settings, approvalPolicy: mode, approvalsReviewer: "user" };
}

export function updateGranularApprovalCategory<T extends ApprovalSettings>(
  settings: T,
  category: keyof AgentGranularApprovalConfig,
  enabled: boolean,
): T {
  const policy = isGranularApprovalPolicy(settings.approvalPolicy)
    ? settings.approvalPolicy
    : DEFAULT_AGENT_GRANULAR_APPROVAL_POLICY;
  return {
    ...settings,
    approvalPolicy: { granular: { ...policy.granular, [category]: enabled } },
  };
}
