/** 在用户点击栈中提交剪贴板请求，HTML 的加载与解析延后完成，保留 WebKit 的用户激活权限。 */
export function copyFormattedMessage(markdown: string): Promise<void> {
  const html = import("./message-clipboard-html.js")
    .then(({ messageClipboardHtml }) => new Blob([messageClipboardHtml(markdown)], { type: "text/html" }));
  return navigator.clipboard.write([new ClipboardItem({
    "text/html": html,
  })]);
}
