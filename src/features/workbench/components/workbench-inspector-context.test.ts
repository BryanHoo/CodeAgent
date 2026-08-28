import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchInspector } from "./workbench-inspector.js";

describe("WorkbenchInspector temporary context", () => {
  it("keeps the context tab and empty state without an active terminal", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(WorkbenchInspector, {
          contextOnly: true,
          projectName: "Temporary task",
          projectPath: "",
          projectRootId: "",
        }),
      ),
    );

    expect(markup).toContain('role="tab"');
    expect(markup).toContain(i18n.t("inspector.emptyContext", { ns: "conversation" }));
    expect(markup).not.toContain(i18n.t("inspector.terminals", { ns: "conversation" }));
  });
});
