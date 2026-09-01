import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../../i18n/i18n.js";
import { MessageResponse } from "./message-response.js";

describe("MessageResponse file reference menu", () => {
  it("opens the containing folder from a streaming file reference", async () => {
    const onOpenFileReference = vi.fn();
    const screen = await render(
      <MessageResponse mode="streaming" onOpenFileReference={onOpenFileReference}>
        {"[main.ts](/workspace/src/main.ts:12)"}
      </MessageResponse>,
    );
    const reference = screen.container.querySelector<HTMLElement>("[data-file-reference]");
    expect(reference).not.toBeNull();
    reference?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    const action = screen.getByText(
      i18n.t("openMenu.openContainingFolder", { ns: "workbench" }),
    );
    await expect.element(action).toBeVisible();
    await action.click();

    expect(onOpenFileReference).toHaveBeenCalledWith(
      { lineNumber: 12, path: "/workspace/src/main.ts" },
      "containing-folder",
    );
  });
});
