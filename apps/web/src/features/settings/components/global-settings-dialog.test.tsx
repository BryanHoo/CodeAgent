import { renderToStaticMarkup } from "react-dom/server";
import type { AgentModel } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";

import { GlobalSettingsDialog, resolveGlobalSettingsModel } from "./global-settings-dialog.js";

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
  it("renders all global defaults with accessible AI Elements selects", () => {
    const markup = renderToStaticMarkup(
      <GlobalSettingsDialog
        apps={[
          { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
          { id: "finder", kind: "file-manager", name: "Finder" },
        ]}
        error={null}
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
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        }}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="设置分类"');
    expect(markup).toContain("外观");
    expect(markup).toContain("Agent 默认值");
    expect(markup).toContain("提交消息");
    expect(markup).toContain("应用集成");
    expect(markup).toContain('aria-label="浅色模式"');
    expect(markup).toContain('aria-label="深色模式"');
    expect(markup).toContain('aria-label="审批"');
    expect(markup).toContain('aria-label="工作区"');
    expect(markup).toContain('aria-label="模型"');
    expect(markup).toContain('aria-label="思考"');
    expect(markup).toContain('aria-label="默认打开方式"');
    expect(markup).toContain('aria-label="提交模型"');
    expect(markup).toContain('aria-label="提交思考量"');
    expect(markup).toContain('aria-label="提交提示词"');
    expect(markup.match(/<select/gu)).toHaveLength(7);
    expect(markup).toContain("突出用户可见影响。");
    expect(markup).toContain("保存全局默认");
  });

  it("uses the selected model default when the previous effort is unavailable", () => {
    expect(resolveGlobalSettingsModel(models, "gpt-5.6-terra", "high")).toEqual({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
  });
});
