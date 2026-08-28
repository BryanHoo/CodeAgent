export const common = {
  actions: {
    backToWorkbench: "Back to workbench",
    retry: "Retry",
  },
  app: {
    actionFailed: "Action failed",
    actionSucceeded: "Action completed",
    loadingProjects: "Loading projects",
    noProjects: "No projects added",
    notificationRegion: "Notifications",
  },
  errors: {
    notFoundDescription: "This address does not match a registered application route.",
    notFoundTitle: "Page not found",
    routeErrorLabel: "Route error",
    routeErrorTitle: "Failed to load page",
    runtimeUnavailableDescription:
      "First run <command>codex login</command> in the official Codex CLI, then retry after signing in.",
    runtimeUnavailableTitle: "Codex Runtime unavailable",
  },
  language: {
    english: "English",
    simplifiedChinese: "Simplified Chinese",
  },
} as const;
