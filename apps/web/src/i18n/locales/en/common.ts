export const common = {
  access: {
    checking: "Checking access",
    codeLabel: "Pairing code",
    loadError: "Unable to check access",
    pair: "Pair",
    pairing: "Pairing",
    pairingDescription: "Enter the pairing code shown in the CodeAgent terminal.",
    pairingError: "Unable to pair. Check the pairing code and try again",
    pairingTitle: "Connect to a trusted LAN session",
  },
  actions: {
    backToWorkbench: "Back to workbench",
    retry: "Retry",
  },
  app: {
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
