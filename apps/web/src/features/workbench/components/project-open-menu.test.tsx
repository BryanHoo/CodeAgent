import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "../../../shared/components/core/context-menu.js";
import { getProjectOpenAppsForTarget, ProjectOpenContextMenuItems } from "./project-open-menu.js";

describe("ProjectOpenContextMenuItems", () => {
  it("renders copy, open, and reference commands as one target menu", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ProjectOpenContextMenuItems
          apps={[
            { id: "zed", kind: "editor", name: "Zed" },
            { id: "finder", kind: "file-manager", name: "Finder" },
          ]}
          isPending={false}
          onReference={vi.fn()}
          onSelect={vi.fn()}
          target={{
            path: "README.md",
            reference: { name: "README.md", path: "README.md" },
            type: "file",
          }}
        />
      </ContextMenu>,
    );

    expect(markup).toContain('data-slot="context-menu-content"');
    expect(markup).toContain("复制名称");
    expect(markup).toContain("复制路径");
    expect(markup).toContain("打开");
    expect(markup).toContain("引用");
    expect(markup.match(/data-slot="context-menu-sub-trigger"/gu)).toHaveLength(1);
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(3);
    expect(markup).not.toContain("menuitemradio");
    expect(markup).not.toContain("aria-checked");
  });

  it("removes the reference command for directory targets", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ProjectOpenContextMenuItems
          apps={[{ id: "zed", kind: "editor", name: "Zed" }]}
          isPending={false}
          onReference={vi.fn()}
          onSelect={vi.fn()}
          target={{ path: "src", type: "directory" }}
        />
      </ContextMenu>,
    );

    expect(markup).not.toContain("引用");
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(2);
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
