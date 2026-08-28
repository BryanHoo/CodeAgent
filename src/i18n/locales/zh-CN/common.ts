export const common = {
  actions: {
    backToWorkbench: "返回工作台",
    retry: "重试",
  },
  app: {
    actionFailed: "操作失败",
    actionSucceeded: "操作成功",
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
