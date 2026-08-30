import type { AgentProviderConnectionStatus } from "@/protocol/index.js";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { ProviderConnectionPanelView } from "./provider-connection-panel.js";

function ProviderConnectionHarness({
  onConfigure,
}: Readonly<{ onConfigure: (input: { apiKey: string; baseUrl: string }) => void }>) {
  const [mode, setMode] = useState<"custom" | "official">("official");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  return (
    <I18nextProvider i18n={i18n}>
      <ProviderConnectionPanelView
        apiKey={apiKey}
        baseUrl={baseUrl}
        error={null}
        isBusy={false}
        mode={mode}
        models={[]}
        onAddModel={() => undefined}
        onApiKeyChange={setApiKey}
        onBaseUrlChange={setBaseUrl}
        onCancelLogin={() => undefined}
        onConfigureCustom={() => {
          onConfigure({ apiKey, baseUrl });
        }}
        onLogout={() => undefined}
        onModelChange={() => undefined}
        onModeChange={setMode}
        onRemoveModel={() => undefined}
        onRetry={() => undefined}
        onStartOfficialLogin={() => undefined}
        status={
          {
            account: null,
            customBaseUrl: null,
            mode: "official",
            pendingLogin: null,
            state: "disconnected",
          } satisfies AgentProviderConnectionStatus
        }
      />
    </I18nextProvider>
  );
}

describe("ProviderConnectionPanelView", () => {
  it("通过真实输入与点击提交自定义 Provider 配置", async () => {
    await i18n.changeLanguage("zh-CN");
    const onConfigure = vi.fn();
    const screen = await render(<ProviderConnectionHarness onConfigure={onConfigure} />);

    await screen.getByRole("button", { name: "自定义 API" }).click();
    await screen.getByRole("textbox", { name: "API Base URL" }).fill("https://gateway.test/v1");
    await screen.getByLabelText("API Key（可选）").fill("sk-browser-test");
    await screen.getByRole("button", { name: "连接" }).click();

    expect(onConfigure).toHaveBeenCalledWith({
      apiKey: "sk-browser-test",
      baseUrl: "https://gateway.test/v1",
    });
  });
});
