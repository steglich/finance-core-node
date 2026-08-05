import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { ProfileController } from "../identity/api/profile-controller.js";
import { getCompanyId } from "../identity/api/middlewares.js";
import { sendResult } from "./reply.js";

export interface ProfileRoutesDependencies {
  controller: ProfileController;
  authenticate: preHandlerHookHandler;
}

/**
 * Profile routes, mounted under /api/v1/profiles.
 * The company scope always comes from the token, never from the client.
 */
export function createProfileRoutes(
  deps: ProfileRoutesDependencies,
): FastifyPluginAsync {
  const { controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get("/", async (request, reply) =>
      sendResult(reply, await controller.list(getCompanyId(request))),
    );

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.put<{ Params: { profileId: string } }>(
      "/:profileId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(request.params.profileId, request.body),
        ),
    );

    app.delete<{ Params: { profileId: string } }>(
      "/:profileId",
      async (request, reply) =>
        sendResult(reply, await controller.delete(request.params.profileId)),
    );
  };
}
