import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  getProjectOpenAppsForTarget,
  getProjectOpenContextMenuPosition,
  ProjectOpenMenuItems,
} from "./project-open-menu.js";

describe("ProjectOpenMenuItems", () => {
  it("renders detected apps by name and marks the current selection", () => {
    const markup = renderToStaticMarkup(
      <ProjectOpenMenuItems
        apps={[
          { id: "zed", kind: "editor", name: "Zed" },
          { id: "finder", kind: "file-manager", name: "Finder" },
          { id: "ghostty", kind: "terminal", name: "Ghostty" },
        ]}
        isPending={false}
        onSelect={vi.fn()}
        selectedAppId="zed"
      />,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain("Zed");
    expect(markup).toContain("Finder");
    expect(markup).toContain("Ghostty");
    expect(markup).toContain('aria-checked="true"');
  });

  it("disables every app choice while an action is pending", () => {
    const markup = renderToStaticMarkup(
      <ProjectOpenMenuItems
        apps={[
          { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
          { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
        ]}
        isPending
        onSelect={vi.fn()}
        selectedAppId="explorer"
      />,
    );

    expect(markup).toContain("文件资源管理器");
    expect(markup).toContain("Visual Studio Code");
    expect(markup.match(/disabled=""/gu)).toHaveLength(2);
  });

  it("renders reused app choices as context-menu commands without changing selection", () => {
    const markup = renderToStaticMarkup(
      <ProjectOpenMenuItems
        apps={[
          { id: "zed", kind: "editor", name: "Zed" },
          { id: "finder", kind: "file-manager", name: "Finder" },
        ]}
        ariaLabel="打开 README.md 的方式"
        detail="README.md"
        isPending={false}
        mode="command"
        onSelect={vi.fn()}
        title="打开方式"
      />,
    );

    expect(markup).toContain('aria-label="打开 README.md 的方式"');
    expect(markup).toContain("打开方式");
    expect(markup).toContain("README.md");
    expect(markup.match(/role="menuitem"/gu)).toHaveLength(2);
    expect(markup).not.toContain("menuitemradio");
    expect(markup).not.toContain("aria-checked");
  });

  it("keeps the context menu inside the viewport near the bottom-right edge", () => {
    expect(
      getProjectOpenContextMenuPosition({
        appCount: 3,
        pointerX: 980,
        pointerY: 740,
        viewportHeight: 768,
        viewportWidth: 1_000,
      }),
    ).toEqual({ left: 752, top: 594 });
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
      <ProjectOpenMenuItems apps={apps} isPending={false} onSelect={vi.fn()} />,
    );
    expect(markup).toContain("系统默认应用");
    expect(markup).not.toContain("__SYSTEM_DEFAULT__");
  });
});
