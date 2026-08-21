import { renderToStaticMarkup } from "react-dom/server";
import type { AppInfoResponse, AgentModel } from "@code-agent/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { GlobalSettingsDialog, resolveGlobalSettingsModel } from "./global-settings-dialog.js";
import { GlobalSettingsAbout } from "./global-settings-about.js";
import { AppReleaseNotesDialog } from "./app-release-notes-dialog.js";

function renderSettingsDialog(children: ReactNode): string {
  return renderToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

const models: AgentModel[] = [
  {
    defaultReasoningEffort: "high",
    description: "复杂任务",
    displayName: "GPT-5.6 Sol",
    id: "gpt-5.6-sol",
    isDefault: true,
    supportedReasoningEfforts: [
      { description: "低", id: "low" },
      { description: "高", id: "high" },
    ],
  },
  {
    defaultReasoningEffort: "medium",
    description: "日常任务",
    displayName: "GPT-5.6 Terra",
    id: "gpt-5.6-terra",
    isDefault: false,
    supportedReasoningEfforts: [{ description: "中", id: "medium" }],
  },
];

describe("GlobalSettingsDialog", () => {
  beforeEach(async () => {
    await changeAppLanguage("zh-CN");
  });

  it("renders all global defaults with accessible 项目 Agent 组件 selects", () => {
    const markup = renderSettingsDialog(
      <GlobalSettingsDialog
        apps={[
          { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
          { id: "system-default", kind: "system-default", name: "__SYSTEM_DEFAULT__" },
          { id: "finder", kind: "file-manager", name: "Finder" },
        ]}
        error={null}
        fastModeAvailable
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        settings={{
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          commitMessageModel: "gpt-5.6-terra",
          commitMessagePrompt: "突出用户可见影响。",
          commitMessageReasoningEffort: "medium",
          defaultOpenAppId: "visual-studio-code",
          fastMode: true,
          followUpBehavior: "queue",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        }}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-labelledby="global-settings-title"');
    expect(markup).toContain('aria-label="设置分类"');
    expect(markup).toContain("外观");
    expect(markup).toContain("Agent 默认值");
    expect(markup).toContain("提交消息");
    expect(markup).toContain("应用集成");
    expect(markup).toContain("模型服务");
    expect(markup).toContain('aria-label="自动模式"');
    expect(markup).toContain('aria-label="浅色模式"');
    expect(markup).toContain('aria-label="深色模式"');
    expect(markup).toContain('aria-label="审批"');
    expect(markup).toContain('aria-label="工作区"');
    expect(markup).toContain('aria-label="跟进消息"');
    expect(markup).toContain('aria-label="快速模式"');
    expect(markup).toContain("排队");
    expect(markup).toContain("引导");
    expect(markup).toContain('aria-label="模型"');
    expect(markup).toContain('aria-label="思考量"');
    expect(markup).toContain('aria-label="语言"');
    expect(markup).toContain('aria-label="默认打开方式"');
    expect(markup).toContain('aria-label="提交模型"');
    expect(markup).toContain('aria-label="提交思考量"');
    expect(markup).toContain('aria-label="提交提示词"');
    expect(markup.match(/<select/gu)).toHaveLength(9);
    expect(markup).toContain("突出用户可见影响。");
    expect(markup).toContain("保存全局默认");
    expect(markup).not.toContain("__SYSTEM_DEFAULT__");
  });

  it("offers explicit logout only for LAN access", () => {
    const markup = renderSettingsDialog(
      <GlobalSettingsDialog
        accessMode="lan"
        apps={[]}
        error={null}
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onLogoutAccess={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        settings={{
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          commitMessageModel: "gpt-5.6-sol",
          commitMessagePrompt: "",
          commitMessageReasoningEffort: "high",
          defaultOpenAppId: null,
          fastMode: false,
          followUpBehavior: "queue",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        }}
      />,
    );

    expect(markup).toContain("局域网访问");
    expect(markup).toContain("退出局域网访问");
    expect(markup).not.toContain('aria-label="快速模式"');
  });

  it("shows CodeAgent and Codex versions with an available update", () => {
    const appInfo: AppInfoResponse = {
      appVersion: "1.3.0",
      codexVersion: "0.148.0",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available" as const,
      updateAvailable: true,
    };
    const markup = renderSettingsDialog(
      <GlobalSettingsDialog
        appInfo={appInfo}
        appInfoError={null}
        apps={[]}
        error={null}
        initialSection="about"
        isAppInfoPending={false}
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onRetryAppInfo={vi.fn()}
        onSave={vi.fn()}
        onUpdate={vi.fn()}
        settings={{
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          commitMessageModel: "gpt-5.6-sol",
          commitMessagePrompt: "",
          commitMessageReasoningEffort: "high",
          defaultOpenAppId: null,
          fastMode: false,
          followUpBehavior: "queue",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        }}
      />,
    );

    expect(markup).toContain("关于");
    expect(markup).toContain("CodeAgent 版本");
    expect(markup).toContain("1.3.0");
    expect(markup).toContain("Codex 版本");
    expect(markup).toContain("0.148.0");
    expect(markup).toContain("发现新版本 1.4.0");
    expect(markup).toContain("检查更新");
    expect(markup).toContain("更新日志");
    expect(markup).toContain("更新到 1.4.0");
    expect(markup).toContain('class="flex min-w-0 flex-wrap items-center gap-2 py-2"');
    expect(markup).not.toContain('class="flex min-w-0 flex-col items-start gap-2 py-2"');
    expect(markup).toContain("https://github.com/BryanHoo/CodeAgent");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain("justify-self-start");
    expect(markup).toContain('<section id="settings-panel-about">');
  });

  it("keeps About available when global settings fail to load", () => {
    const markup = renderSettingsDialog(
      <GlobalSettingsDialog
        appInfo={{
          appVersion: "1.3.0",
          codexVersion: "0.148.0",
          latestVersion: "1.4.0",
          releaseNotes: "### 新增\n\n- 添加在线更新。",
          status: "available",
          updateAvailable: true,
        }}
        apps={[]}
        error={new Error("settings unavailable")}
        initialSection="about"
        isPending={false}
        models={models}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(markup).toContain("CodeAgent 版本");
    expect(markup).toContain("Codex 版本");
    expect(markup).not.toContain("加载全局设置失败");
  });

  it("shows updating, restart, and update-check failure states", () => {
    const available: AppInfoResponse = {
      appVersion: "1.3.0",
      codexVersion: "0.148.0",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available",
      updateAvailable: true,
    };
    const updating = renderSettingsDialog(
      <GlobalSettingsAbout
        activeSection="about"
        appInfo={available}
        error={null}
        isPending={false}
        isUpdatePending
        onRetry={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const restartRequired = renderSettingsDialog(
      <GlobalSettingsAbout
        activeSection="about"
        appInfo={{
          ...available,
          status: "restart-required",
          updateAvailable: false,
        }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const checkFailed = renderSettingsDialog(
      <GlobalSettingsAbout
        activeSection="about"
        appInfo={{
          ...available,
          latestVersion: null,
          status: "check-failed",
          updateAvailable: false,
        }}
        error={null}
        isPending={false}
        onRetry={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(updating).toContain("正在更新");
    expect(restartRequired).toContain("更新完成，重启 CodeAgent 后生效");
    expect(checkFailed).toContain("无法检查更新");
    expect(checkFailed).toContain("检查更新");
  });

  it("renders detailed release notes in a dedicated dialog", () => {
    const markup = renderSettingsDialog(
      <AppReleaseNotesDialog
        notes={"### 新增\n\n- 添加在线更新。"}
        onClose={vi.fn()}
        open
        version="1.4.0"
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("1.4.0 更新日志");
    expect(markup).toContain("添加在线更新");
  });

  it("uses the selected model default when the previous effort is unavailable", () => {
    expect(resolveGlobalSettingsModel(models, "gpt-5.6-terra", "high")).toEqual({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
  });

  it("renders official Codex terminology in English without rewriting model data", async () => {
    await changeAppLanguage("en");
    try {
      const markup = renderSettingsDialog(
        <GlobalSettingsDialog
          apps={[]}
          error={null}
          isPending={false}
          models={models}
          onClose={vi.fn()}
          onRetry={vi.fn()}
          onSave={vi.fn()}
          settings={{
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            commitMessageModel: "gpt-5.6-sol",
            commitMessagePrompt: "",
            commitMessageReasoningEffort: "high",
            defaultOpenAppId: null,
            fastMode: false,
            followUpBehavior: "queue",
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            sandboxMode: "workspace-write",
          }}
        />,
      );

      expect(markup).toContain("Global settings");
      expect(markup).toContain("Approval policy");
      expect(markup).toContain("Reasoning effort");
      expect(markup).toContain('aria-label="Language"');
      expect(markup).toContain("GPT-5.6 Sol");
      expect(markup).toContain(">High</option>");
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });
});
