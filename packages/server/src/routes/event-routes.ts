import type { EventStreamMessage } from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";
import { sendEventStreamMessage } from "../event-socket-sender.js";

import type { ServerRouteContext } from "./context.js";
import { EventQuerySchema, ProjectParamsSchema } from "./schemas.js";

export const registerEventRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { getProjectContext, projectContexts } = context;

  app.get<{ Params: { projectId: string }; Querystring: { afterSequence: number } }>(
    "/v1/projects/:projectId/events",
    {
      async preValidation(request, reply) {
        if ((await getProjectContext(request.params.projectId)) === undefined) {
          return await reply
            .code(404)
            .send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
        }
        const origin = request.headers.origin;
        const host = request.headers.host;
        if (origin === undefined) {
          return;
        }
        try {
          const parsedOrigin = new URL(origin);
          if (
            host === undefined ||
            (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
            parsedOrigin.host !== host
          ) {
            return await reply
              .code(403)
              .send({ code: "ORIGIN_REJECTED", message: "Origin rejected" });
          }
        } catch {
          return await reply
            .code(403)
            .send({ code: "ORIGIN_REJECTED", message: "Origin rejected" });
        }
      },
      schema: { params: ProjectParamsSchema, querystring: EventQuerySchema },
      websocket: true,
    },
    (socket, request) => {
      const context = projectContexts.get(request.params.projectId);
      if (context === undefined) {
        socket.close(1008, "Project not found");
        return;
      }
      const eventStream = context.eventStream;
      context.transportMetrics.activeClients += 1;
      let cleanedUp = false;
      let unsubscribe: () => void = () => undefined;
      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        unsubscribe();
        context.transportMetrics.activeClients -= 1;
      };
      socket.once("close", cleanup);
      socket.once("error", cleanup);
      const send = (message: EventStreamMessage): boolean =>
        sendEventStreamMessage(
          socket,
          message,
          () => {
            eventStream.noteBackpressure();
          },
          () => {
            context.transportMetrics.slowClientDisconnects += 1;
          },
        );
      const replay = eventStream.replayAfter(request.query.afterSequence);
      if (replay.type === "resync") {
        const sent = send({
          latestSequence: replay.latestSequence,
          reason: replay.reason,
          sessionId: eventStream.checkpoint.sessionId,
          type: "resync.required",
          version: 2,
        });
        if (sent) {
          socket.close(1000, "Snapshot resync required");
        }
        return;
      }

      // checkpoint getter 会同步冲刷待发送增量，必须在注册连接监听器前读取。
      const checkpoint = eventStream.checkpoint;
      // 同步建立实时订阅并挂载清理回调，避免补发与实时事件之间出现空窗。
      unsubscribe = eventStream.subscribe((event) => {
        send(event);
      });
      send({
        latestSequence: checkpoint.sequence,
        sessionId: checkpoint.sessionId,
        type: "connection.ready",
        version: 2,
      });
      for (const event of replay.events) {
        if (!send(event)) {
          return;
        }
      }
    },
  );
  done();
};
