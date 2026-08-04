export const common = {
  access: {
    checking: "正在验证访问权限",
    codeLabel: "配对码",
    loadError: "无法验证访问权限",
    pair: "配对",
    pairing: "正在配对",
    pairingDescription: "输入 CodeAgent 启动终端中显示的配对码。",
    pairingError: "无法完成配对，请检查配对码后重试",
    pairingTitle: "连接可信局域网会话",
  },
  actions: {
    backToWorkbench: "返回工作台",
    retry: "重试",
  },
  app: {
    loadingProjects: "正在加载项目",
    noProjects: "尚未添加项目",
    notificationRegion: "通知",
  },
  errors: {
    notFoundDescription: "当前地址不属于已注册的应用路由。",
    notFoundTitle: "页面不存在",
    routeErrorLabel: "路由错误",
    routeErrorTitle: "页面加载失败",
    runtimeUnavailableDescription:
      "请先在官方 Codex CLI 中运行 <command>codex login</command>，完成登录后重试。",
    runtimeUnavailableTitle: "Codex Runtime 不可用",
  },
  language: {
    english: "English",
    simplifiedChinese: "简体中文",
  },
} as const;
