import { Marked } from "marked";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

const parser = new Marked({
  async: false,
  gfm: true,
  renderer: {
    // 不把模型原文中的 HTML、脚本或图片资源带入目标应用；代码围栏仍由解析器正确转义。
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      try {
        const url = new URL(href);
        if (["http:", "https:", "mailto:"].includes(url.protocol)) {
          return `<a href="${escapeHtml(url.href)}">${label}</a>`;
        }
      } catch { /* 本地路径及页内引用在其他应用中只保留显示文本。 */ }
      return label;
    },
  },
});

export function messageClipboardHtml(markdown: string): string {
  return parser.parse(markdown, { async: false });
}
