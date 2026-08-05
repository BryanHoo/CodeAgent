import { relative, sep } from "node:path";

import { MAX_AGENT_FILE_BYTES } from "@code-agent/protocol";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";

import { AccessSessionService, type CodeAgentAccessOptions } from "./access-control.js";
import { ACCESS_SESSION_COOKIE } from "./routes/access-routes.js";
import { MutationHttpError } from "./routes/context.js";

export interface ConfigureServerDeliveryOptions {
  access?: CodeAgentAccessOptions;
  releaseResources: () => Promise<void>;
  staticRoot?: string;
}

export async function configureServerDelivery(
  app: FastifyInstance,
  options: ConfigureServerDeliveryOptions,
): Promise<AccessSessionService | undefined> {
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(fastifyCookie);
  const accessService =
    options.access === undefined ? undefined : new AccessSessionService(options.access);
  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    const websocket = request.headers.upgrade?.toLowerCase() === "websocket";
    const sessionId = request.cookies[ACCESS_SESSION_COOKIE];
    const authenticated =
      options.access === undefined || accessService?.validate(sessionId) === true;
    const anonymous =
      !pathname.startsWith("/v1/") ||
      (request.method === "GET" && (pathname === "/v1/health" || pathname === "/v1/access")) ||
      (request.method === "POST" && pathname === "/v1/access/pair");

    if (!anonymous && !authenticated) {
      return reply
        .code(401)
        .send({ code: "ACCESS_DENIED", message: "Access denied", retryable: false });
    }

    const browserWrite =
      !["GET", "HEAD", "OPTIONS"].includes(request.method) && sessionId !== undefined;
    if (websocket || browserWrite) {
      const origin = request.headers.origin;
      const host = request.headers.host;
      try {
        const parsedOrigin = origin === undefined ? undefined : new URL(origin);
        if (
          parsedOrigin === undefined ||
          host === undefined ||
          (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
          parsedOrigin.host !== host
        ) {
          throw new Error("Origin mismatch");
        }
      } catch {
        return reply
          .code(403)
          .send({ code: "ACCESS_DENIED", message: "Access denied", retryable: false });
      }
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.headers({
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    if (request.url.startsWith("/v1/")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });
  await app.register(fastifyMultipart, {
    limits: { fields: 0, files: 1, fileSize: MAX_AGENT_FILE_BYTES, parts: 1 },
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof MutationHttpError) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    }
    if (typeof error === "object" && error !== null && "validation" in error) {
      const key = request.headers["idempotency-key"];
      const accessMutation =
        request.routeOptions.url === "/v1/access/pair" ||
        request.routeOptions.url === "/v1/access/logout";
      const missingKey =
        !accessMutation &&
        (request.method === "POST" || request.method === "PUT") &&
        (key === undefined || key === "");
      return reply.code(400).send({
        code: missingKey ? "IDEMPOTENCY_KEY_REQUIRED" : "INVALID_REQUEST",
        message: missingKey ? "Idempotency-Key header is required" : "Request is invalid",
        retryable: false,
      });
    }
    return reply.send(error);
  });
  app.addHook("onClose", async () => {
    // Access 状态与运行时资源统一随 Fastify 实例失效。
    accessService?.close();
    await options.releaseResources();
  });

  const { staticRoot } = options;
  if (staticRoot !== undefined) {
    // 压缩插件必须先于静态插件注册，确保静态文件流进入响应压缩钩子。
    await app.register(fastifyCompress, {
      encodings: ["br", "gzip"],
      globalDecompression: false,
    });
    await app.register(fastifyStatic, {
      cacheControl: false,
      root: staticRoot,
      setHeaders: (reply, filePath) => {
        const [topLevelDirectory] = relative(staticRoot, filePath).split(sep);
        // Vite 的 assets 目录使用内容哈希命名，可安全长期缓存；HTML 等入口继续重新验证。
        reply.header(
          "Cache-Control",
          topLevelDirectory === "assets"
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0",
        );
      },
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/v1/")) {
        // Browser 深链统一回到 SPA 入口，API 未命中仍保持 JSON 404。
        return reply.type("text/html; charset=utf-8").sendFile("index.html");
      }
      return reply.code(404).send({ code: "NOT_FOUND", message: "Route not found" });
    });
  }
  return accessService;
}
