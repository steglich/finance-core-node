import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { CompanyController } from "../identity/api/company-controller.js";
import { getAuthContext } from "../identity/api/middlewares.js";
import { sendResult } from "./reply.js";

export interface CompanyRoutesDependencies {
  controller: CompanyController;
  authenticate: preHandlerHookHandler;
}

/**
 * Company routes, mounted under /api/v1/companies.
 * Every route requires a valid access token.
 */
export function createCompanyRoutes(
  deps: CompanyRoutesDependencies,
): FastifyPluginAsync {
  const { controller, authenticate } = deps;

  return async (app) => {
    // Scoped to this plugin only — Fastify encapsulation keeps it off /auth
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(reply, await controller.create(request.body)),
    );

    app.get("/", async (request, reply) =>
      sendResult(reply, await controller.list(getAuthContext(request).userId)),
    );

    app.post<{ Params: { companyId: string } }>(
      "/:companyId/users",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.inviteUser(request.params.companyId, request.body),
        ),
    );

    app.delete<{ Params: { companyId: string; userId: string } }>(
      "/:companyId/users/:userId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.removeUser(
            request.params.companyId,
            request.params.userId,
          ),
        ),
    );
  };
}
