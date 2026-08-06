import { BrowserSessionResponseSchema } from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";

export function registerBrowserSessionRoute(
  app: FastifyInstance,
  instanceId: string,
  onBrowserConnection?: () => void,
): void {
  app.get(
    "/v1/browser-session",
    { schema: { response: { 200: BrowserSessionResponseSchema } } },
    () => {
      // 页面轮询既用于报告旧标签存在，也用于识别服务是否已重新启动。
      onBrowserConnection?.();
      return { instanceId, version: 1 as const };
    },
  );
}
