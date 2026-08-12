import { Buffer } from "node:buffer";

import type { FastifyPluginCallback } from "fastify";
import type { WebSocket } from "ws";

import { ACCESS_SESSION_COOKIE } from "./access-routes.js";
import { createReadRequestId, type ServerRouteContext } from "./context.js";
import { EventQuerySchema, ProjectParamsSchema } from "./schemas.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const SOFT_BACKPRESSURE_BYTES = 256 * 1_024;
const HARD_BACKPRESSURE_BYTES = 1_024 * 1_024;

function scheduleSessionExpiry(socket: WebSocket, expiresAt: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      socket.close(1008, "Access session expired");
      return;
    }
    timer = setTimeout(expire, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    timer.unref();
  };
  expire();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
  };
}

export const registerEventRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  { accessService, engine, eventMetrics },
  done,
) => {
  app.get<{ Params: { projectId: string }; Querystring: { afterSequence: number } }>(
    "/v1/projects/:projectId/events",
    { schema: { params: ProjectParamsSchema, querystring: EventQuerySchema }, websocket: true },
    (socket, request) => {
      const sessionExpiresAt = accessService?.expiresAt(request.cookies[ACCESS_SESSION_COOKIE]);
      if (accessService !== undefined && sessionExpiresAt === undefined) {
        socket.close(1008, "Access session expired");
        return;
      }
      const metrics = eventMetrics.projects.get(request.params.projectId) ?? {
        activeClients: 0,
        backpressureSignals: 0,
        slowClientDisconnects: 0,
      };
      eventMetrics.projects.set(request.params.projectId, metrics);
      metrics.activeClients += 1;
      let cleanedUp = false;
      let unsubscribe = () => undefined;
      const cancelExpiry =
        sessionExpiresAt === undefined || sessionExpiresAt === null
          ? () => undefined
          : scheduleSessionExpiry(socket, sessionExpiresAt);
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        cancelExpiry();
        unsubscribe();
        metrics.activeClients -= 1;
      };
      socket.once("close", cleanup);
      socket.once("error", cleanup);
      try {
        const subscription = engine.eventSubscribe(
          createReadRequestId(),
          request.params.projectId,
          "",
          request.query.afterSequence,
          (frame) => {
            if (socket.readyState !== 1) return;
            if (socket.bufferedAmount > HARD_BACKPRESSURE_BYTES) {
              metrics.slowClientDisconnects += 1;
              socket.close(1013, "Client is too slow; refresh the snapshot");
              return;
            }
            if (socket.bufferedAmount > SOFT_BACKPRESSURE_BYTES) {
              metrics.backpressureSignals += 1;
            }
            // native 已完成一次协议序列化；这里只做 UTF-8 视图转换以保持文本 WebSocket 帧。
            socket.send(Buffer.from(frame).toString("utf8"));
          },
        );
        unsubscribe = () => {
          subscription.unsubscribe();
        };
      } catch {
        socket.close(1011, "Event subscription failed");
      }
    },
  );
  done();
};
