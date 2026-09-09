import { i18n } from "./i18n.js";

// 壁纸图库仅随设置页加载，避免增加工作台首屏的语言资源。
i18n.addResourceBundle("zh-CN", "settings", { wallpaper: {
  source: "壁纸来源", close: "关闭预览",
  collection: "Bing 每日壁纸", recent: "最近九天", daily: "每日自动更新", selected: "当前使用",
  download: "下载原图", downloading: "正在下载", downloaded: "已保存 {{name}}",
  loading: "正在加载壁纸", loadError: "壁纸加载失败", retry: "重新加载",
  custom: "我的壁纸", empty: "还没有添加壁纸", upload: "添加图片",
  adjustments: "显示效果", reset: "重置显示效果", imageError: "图片无法预览",
  select: "使用 {{name}}", view: "预览 {{name}}", downloadImage: "下载 {{name}}",
} }, true);
i18n.addResourceBundle("en", "settings", { wallpaper: {
  source: "Wallpaper source", close: "Close preview",
  collection: "Bing daily wallpapers", recent: "Last nine days", daily: "Update daily", selected: "In use",
  download: "Download original", downloading: "Downloading", downloaded: "Saved {{name}}",
  loading: "Loading wallpapers", loadError: "Unable to load wallpapers", retry: "Reload",
  custom: "My wallpapers", empty: "No wallpapers yet", upload: "Add images",
  adjustments: "Appearance", reset: "Reset appearance", imageError: "Unable to preview image",
  select: "Use {{name}}", view: "Preview {{name}}", downloadImage: "Download {{name}}",
} }, true);
