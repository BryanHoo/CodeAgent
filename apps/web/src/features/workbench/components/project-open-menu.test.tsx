import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectOpenMenuItems } from "./project-open-menu.js";

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
});
