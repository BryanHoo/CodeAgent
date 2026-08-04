import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "../../../shared/ui/context-menu.js";
import { DropdownMenu } from "../../../shared/ui/dropdown-menu.js";
import {
  getProjectOpenAppsForTarget,
  ProjectOpenContextMenuItems,
  ProjectOpenMenuItems,
} from "./project-open-menu.js";

describe("ProjectOpenMenuItems", () => {
  it("renders detected apps by name and marks the current selection", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <ProjectOpenMenuItems
          apps={[
            { id: "zed", kind: "editor", name: "Zed" },
            { id: "finder", kind: "file-manager", name: "Finder" },
            { id: "ghostty", kind: "terminal", name: "Ghostty" },
          ]}
          isPending={false}
          onSelect={vi.fn()}
          selectedAppId="zed"
        />
      </DropdownMenu>,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup.match(/data-slot="dropdown-menu-radio-item"/gu)).toHaveLength(3);
    expect(markup).toContain("Zed");
    expect(markup).toContain("Finder");
    expect(markup).toContain("Ghostty");
    expect(markup).toContain('aria-checked="true"');
  });

  it("disables every app choice while an action is pending", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <ProjectOpenMenuItems
          apps={[
            { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
            { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
          ]}
          isPending
          onSelect={vi.fn()}
          selectedAppId="explorer"
        />
      </DropdownMenu>,
    );

    expect(markup).toContain("文件资源管理器");
    expect(markup).toContain("Visual Studio Code");
    expect(markup.match(/disabled=""/gu)).toHaveLength(2);
  });

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

    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <ProjectOpenMenuItems apps={apps} isPending={false} onSelect={vi.fn()} />
      </DropdownMenu>,
    );
    expect(markup).toContain("系统默认应用");
    expect(markup).not.toContain("__SYSTEM_DEFAULT__");
  });
});
