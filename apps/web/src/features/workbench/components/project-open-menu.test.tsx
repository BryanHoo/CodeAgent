import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "../../../shared/ui/context-menu.js";
import { getProjectOpenAppsForTarget, ProjectOpenContextMenuItems } from "./project-open-menu.js";

describe("ProjectOpenContextMenuItems", () => {
  it("renders context-menu commands without changing selection", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ProjectOpenContextMenuItems
          apps={[
            { id: "zed", kind: "editor", name: "Zed" },
            { id: "finder", kind: "file-manager", name: "Finder" },
          ]}
          detail="README.md"
          isPending={false}
          onSelect={vi.fn()}
          title="打开方式"
        />
      </ContextMenu>,
    );

    expect(markup).toContain('data-slot="context-menu-content"');
    expect(markup).toContain("打开方式");
    expect(markup).toContain("README.md");
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(2);
    expect(markup).not.toContain("menuitemradio");
    expect(markup).not.toContain("aria-checked");
  });

  it("offers the system default application only for file targets", () => {
    const apps = [
      { id: "zed", kind: "editor", name: "Zed" },
      { id: "system-default", kind: "system-default", name: "__SYSTEM_DEFAULT__" },
      { id: "finder", kind: "file-manager", name: "Finder" },
    ] as const;

    expect(getProjectOpenAppsForTarget(apps, "directory").map((app) => app.id)).toEqual([
      "zed",
      "finder",
    ]);
    expect(getProjectOpenAppsForTarget(apps, "file").map((app) => app.id)).toEqual([
      "zed",
      "system-default",
      "finder",
    ]);
  });
});
