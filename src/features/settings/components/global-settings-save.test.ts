import { describe, expect, it, vi } from "vitest";

import type { AgentGlobalSettings } from "@/protocol/index.js";

import {
  saveGlobalSettingsDraft,
  type BrowserSettingsDraft,
} from "./global-settings-save.js";

const globalSettings: AgentGlobalSettings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  commitMessageModel: "gpt-5.6-luna",
  commitMessagePrompt: "",
  defaultOpenAppId: null,
  fastMode: false,
  followUpBehavior: "queue",
  model: "gpt-5.6-sol",
  pet: { enabled: false, selectedPetId: null },
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
};

const browserSettings: BrowserSettingsDraft = {
  background: {
    blurPercentage: 0,
    mode: "none",
    overlayOpacity: 60,
    selectedCustomImageId: null,
  },
  customBackgroundMutation: { deletedImageIds: [], imagesToSave: [] },
  language: "zh-CN",
  notificationsEnabled: true,
  theme: "system",
};

describe("saveGlobalSettingsDraft", () => {
  it("should skip every downstream handler when settings are unchanged", async () => {
    const saveGlobalSettings = vi.fn();
    const applyBrowserSettings = vi.fn();

    await saveGlobalSettingsDraft(
      globalSettings,
      browserSettings,
      globalSettings,
      browserSettings,
      { applyBrowserSettings, saveGlobalSettings },
    );

    expect(saveGlobalSettings).not.toHaveBeenCalled();
    expect(applyBrowserSettings).not.toHaveBeenCalled();
  });

  it("should forward only changed browser fields after the atomic global save", async () => {
    const calls: string[] = [];
    const saveGlobalSettings = vi.fn(async () => {
      calls.push("global");
    });
    const applyBrowserSettings = vi.fn(async () => {
      calls.push("browser");
    });

    await saveGlobalSettingsDraft(
      globalSettings,
      browserSettings,
      { ...globalSettings, model: "gpt-next" },
      { ...browserSettings, language: "en" },
      { applyBrowserSettings, saveGlobalSettings },
    );

    expect(calls).toEqual(["global", "browser"]);
    expect(applyBrowserSettings).toHaveBeenCalledWith({ language: "en" });
  });
});
