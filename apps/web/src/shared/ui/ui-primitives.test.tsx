import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button.js";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.js";
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
});
