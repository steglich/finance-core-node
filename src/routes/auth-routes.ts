import type { FastifyPluginAsync } from "fastify";
import type { AuthController } from "../identity/api/auth-controller.js";
import type { RateLimitConfig } from "../shared/infrastructure/security-config.js";
import { sendResult } from "./reply.js";

/**
 * Public authentication routes, mounted under /api/v1/auth.
 *
 * These routes carry their own, much stricter rate limit: each attempt costs a
 * bcrypt verification at cost 12, so an unthrottled attacker gets both brute
 * force and an asymmetric CPU drain. The limit is registered inside the plugin,
 * so Fastify's encapsulation confines it to /auth without any per-route logic.
 */
export function createAuthRoutes(
  controller: AuthController,
  rateLimitConfig: RateLimitConfig,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook(
      "onRequest",
      app.rateLimit({
        max: rateLimitConfig.max,
        timeWindow: rateLimitConfig.timeWindow,
      }),
    );

    app.post("/register", async (request, reply) =>
      sendResult(reply, await controller.register(request.body)),
    );

    app.post("/login", async (request, reply) =>
      sendResult(reply, await controller.login(request.body, request.ip)),
    );

    app.post("/refresh", async (request, reply) =>
      sendResult(reply, await controller.refresh(request.body)),
    );

    app.post("/recover-password", async (request, reply) =>
      sendResult(reply, await controller.recoverPassword(request.body)),
    );

    app.post("/reset-password", async (request, reply) =>
      sendResult(reply, await controller.resetPassword(request.body)),
    );
  };
}
