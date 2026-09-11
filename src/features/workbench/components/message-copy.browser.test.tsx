import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { MessageMetadata } from "./task-timeline-status.js";
afterEach(() => vi.restoreAllMocks());

test("writes the real clipboard from the click gesture, including deferred HTML in WebKit", async () => {
  const write = vi.spyOn(navigator.clipboard, "write");
  const screen = await render(<TooltipProvider><MessageMetadata text="**格式测试**" /></TooltipProvider>);
  await screen.getByRole("button", { name: /HTML/ }).click();
  expect(write).toHaveBeenCalledOnce();
  await expect(write.mock.results[0]!.value).resolves.toBeUndefined();
});

test("copies original Markdown independently without writing HTML", async () => {
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const text = "# 标题\n\n**重点**";
  const screen = await render(<TooltipProvider><MessageMetadata text={text} /></TooltipProvider>);
  expect(writeText).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: /Markdown/ }).click();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  expect(write).not.toHaveBeenCalled();
});

test("copies formatted HTML independently only when clicked", async () => {
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const text = '# 标题\n\n**重点**\n\n- 第一项\n\n```ts\nconst a = "<safe>";\n```\n\n| 名称 | 值 |\n| --- | --- |\n| A | 1 |\n\n[文档](https://example.com)\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))';
  const screen = await render(<TooltipProvider><MessageMetadata text={text} /></TooltipProvider>);
  expect(write).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: /HTML/ }).click();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  const item = write.mock.calls[0]![0][0]!;
  expect(item.types).toEqual(["text/html"]);
  const html = await (await item.getType("text/html")).text();
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector("h1")?.textContent).toBe("标题");
  expect(document.querySelector("strong")?.textContent).toBe("重点");
  expect(document.querySelector("li")?.textContent).toBe("第一项");
  expect(document.querySelector("pre code")?.textContent).toContain('const a = "<safe>";');
  expect(document.querySelectorAll("td")).toHaveLength(2);
  expect(document.querySelector("a")?.getAttribute("href")).toBe("https://example.com/");
  expect(document.querySelector("script, [href^='javascript:']")).toBeNull();
  expect(writeText).not.toHaveBeenCalled();
});
