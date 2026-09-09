import { i18n } from "./i18n.js";
import { generalSettings as en } from "./locales/en/settings-general.js";
import { generalSettings as zhCN } from "./locales/zh-CN/settings-general.js";

// 常规页说明随设置面板加载，避免增加工作台首屏和辅助窗口的传输体积。
i18n.addResourceBundle("en", "settings", { general: en }, true);
i18n.addResourceBundle("zh-CN", "settings", { general: zhCN }, true);
