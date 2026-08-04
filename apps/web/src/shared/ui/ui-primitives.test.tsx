import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button.js";
import { ButtonGroup } from "./button-group.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu.js";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Input } from "./input.js";
import { Tooltip, TooltipProvider, TooltipTrigger } from "./tooltip.js";

describe("shadcn UI primitives", () => {
  it("renders project button and input slots with native attributes", () => {
    const markup = renderToStaticMarkup(
      <form>
        <Input aria-label="名称" name="name" />
        <Button type="submit">保存</Button>
      </form>,
    );

    expect(markup).toContain('data-slot="input"');
    expect(markup).toContain('aria-label="名称"');
    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("保存");
  });

  it("keeps application-owned visual classes unchanged", () => {
    const markup = renderToStaticMarkup(
      <>
        <Button
          className="flex h-7 text-body-small font-normal text-muted-foreground"
          type="button"
          variant="ghost"
        >
          更多
        </Button>
        <Input aria-label="选择文件" className="size-4 shrink-0" type="checkbox" />
      </>,
    );

    expect(/<button class="([^"]+)"/u.exec(markup)?.[1]).toBe(
      "flex h-7 text-body-small font-normal text-muted-foreground",
    );
    expect(/<input class="([^"]+)"/u.exec(markup)?.[1]).toBe("size-4 shrink-0");
  });

  it("composes tooltip and dialog triggers without replacing their button DOM", () => {
    const tooltipMarkup = renderToStaticMarkup(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">提示</button>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>,
    );
    const dialogMarkup = renderToStaticMarkup(
      <Dialog>
        <DialogTrigger asChild>
          <button type="button">打开</button>
        </DialogTrigger>
      </Dialog>,
    );

    expect(tooltipMarkup.match(/<button/gu)).toHaveLength(1);
    expect(tooltipMarkup).toContain('data-slot="tooltip-trigger"');
    expect(dialogMarkup.match(/<button/gu)).toHaveLength(1);
    expect(dialogMarkup).toContain('data-slot="dialog-trigger"');
  });

  it("keeps dialog content inside the dynamic viewport", () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
        <DialogContent aria-labelledby="dialog-title">
          <DialogTitle id="dialog-title">设置</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(markup).toContain("min-w-0");
    expect(markup).toContain("w-[calc(100%-2rem)]");
  });

  it("composes a portalled dropdown menu without replacing the trigger button", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <button type="button">更多</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="操作菜单">
          <DropdownMenuItem className="text-danger">删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup).toContain('data-slot="dropdown-menu-trigger"');
    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup).toContain('data-slot="dropdown-menu-item"');
    expect(markup).toContain("text-danger");
  });

  it("renders dropdown radio choices inside a button group", () => {
    const groupMarkup = renderToStaticMarkup(
      <ButtonGroup>
        <button type="button">打开</button>
        <button type="button">选择应用</button>
      </ButtonGroup>,
    );
    const menuMarkup = renderToStaticMarkup(
      <DropdownMenu open>
        <DropdownMenuContent aria-label="选择应用">
          <DropdownMenuRadioGroup value="zed">
            <DropdownMenuRadioItem value="zed">Zed</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(groupMarkup).toContain('data-slot="button-group"');
    expect(groupMarkup).toContain('role="group"');
    expect(menuMarkup).toContain('data-slot="dropdown-menu-radio-group"');
    expect(menuMarkup).toContain('data-slot="dropdown-menu-radio-item"');
    expect(menuMarkup).toContain('role="menuitemradio"');
  });

  it("composes a portalled context menu around its existing trigger DOM", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <ContextMenuTrigger asChild>
          <div aria-selected="false" role="treeitem">
            README.md
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label="打开 README.md 的方式">
          <ContextMenuLabel>打开方式</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem>Zed</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    expect(markup.match(/role="treeitem"/gu)).toHaveLength(1);
    expect(markup).toContain('data-slot="context-menu-trigger"');
    expect(markup).toContain('data-slot="context-menu-content"');
    expect(markup).toContain('data-slot="context-menu-label"');
    expect(markup).toContain('data-slot="context-menu-separator"');
    expect(markup).toContain('data-slot="context-menu-item"');
  });
});
