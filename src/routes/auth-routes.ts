import type { FastifyPluginAsync } from "fastify";
import type { AuthController } from "../identity/api/auth-controller.js";
import { sendResult } from "./reply.js";

/**
 * Public authentication routes, mounted under /api/v1/auth.
 */
export function createAuthRoutes(
  controller: AuthController,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/register", async (request, reply) =>
      sendResult(reply, await controller.register(request.body)),
    );

    app.post("/login", async (request, reply) =>
      sendResult(reply, await controller.login(request.body)),
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
