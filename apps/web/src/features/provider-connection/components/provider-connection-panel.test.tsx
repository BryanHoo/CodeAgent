import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { ProviderConnectionPanelView } from "./provider-connection-panel.js";

const handlers = {
  onApiKeyChange: vi.fn(),
  onBaseUrlChange: vi.fn(),
  onCancelLogin: vi.fn(),
  onConfigureCustom: vi.fn(),
  onLogout: vi.fn(),
  onModeChange: vi.fn(),
  onRetry: vi.fn(),
  onStartOfficialLogin: vi.fn(),
};

describe("ProviderConnectionPanelView", () => {
  beforeEach(async () => {
    await changeAppLanguage("zh-CN");
  });

  it("renders a pending official login with a cancellable status", () => {
    const markup = renderToStaticMarkup(
      <ProviderConnectionPanelView
        {...handlers}
        apiKey=""
        baseUrl=""
        error={null}
        isBusy={false}
        mode="official"
        status={{
          account: null,
          customBaseUrl: null,
          mode: "official",
          pendingLogin: { error: null, loginId: "login-1", state: "pending" },
          state: "pending",
        }}
      />,
    );

    expect(markup).toContain("等待浏览器登录");
    expect(markup).toContain("取消登录");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("inline-flex h-10 items-center justify-center gap-2");
    expect(markup).not.toContain("min-h-56");
  });

  it("renders accessible transient custom API fields and connected state", () => {
    const markup = renderToStaticMarkup(
      <ProviderConnectionPanelView
        {...handlers}
        apiKey=""
        baseUrl="https://api.example.com/v1"
        error={null}
        isBusy={false}
        mode="custom"
        status={{
          account: { type: "apiKey" },
          customBaseUrl: "https://api.example.com/v1",
          mode: "custom",
          pendingLogin: null,
          state: "connected",
        }}
      />,
    );

    expect(markup).toContain('type="url"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain("重新连接");
    expect(markup).toContain("已连接");
  });
});
