import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../i18n/i18n.js";
import { PairingGate } from "./pairing-gate.js";

describe("PairingGate", () => {
  beforeEach(() => changeAppLanguage("zh-CN"));

  it("renders an accessible pairing form without exposing internal errors", () => {
    const markup = renderToStaticMarkup(
      <PairingGate
        error="pairing"
        loading={false}
        onPair={vi.fn()}
        onRetry={vi.fn()}
        pairing={false}
      />,
    );

    expect(markup).toContain("CodeAgent");
    expect(markup).toContain('autoComplete="one-time-code"');
    expect(markup).toContain('aria-label="配对码"');
    expect(markup).toContain("无法完成配对，请检查配对码后重试");
    expect(markup).not.toContain("PAIRING_FAILED");
  });
});
