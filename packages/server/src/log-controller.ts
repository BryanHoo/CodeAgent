import { LogController, type FastifyReply, type FastifyRequest } from "fastify";

export class CodeAgentLogController extends LogController {
  public override incomingRequest(): void {
    // 正常请求不写终端日志，仅记录服务端错误的完成上下文。
  }

  public override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    if (reply.statusCode < 500) return;
    request.log.error(
      {
        durationMs: reply.elapsedTime,
        ...(error == null ? {} : { errorCode: error.name }),
        method: request.method,
        requestId: request.id,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
      },
      "request completed",
    );
  }
}
