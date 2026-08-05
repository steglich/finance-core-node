import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { AuditController } from "../auditoria/api/audit-controller.js";
import { getCompanyId } from "../identity/api/middlewares.js";
import { sendResult } from "./reply.js";

export interface AuditRoutesDependencies {
  controller: AuditController;
  authenticate: preHandlerHookHandler;
  /** Guard for the admin-only access log endpoint. */
  requireAuditManage: preHandlerHookHandler;
}

/**
 * Audit routes, mounted under /api/v1/audit. Read-only by design.
 */
export function createAuditRoutes(
  deps: AuditRoutesDependencies,
): FastifyPluginAsync {
  const { controller, authenticate, requireAuditManage } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get<{ Params: { entityType: string; entityId: string } }>(
      "/entities/:entityType/:entityId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.entityHistory(
            getCompanyId(request),
            request.params.entityType,
            request.params.entityId,
          ),
        ),
    );

    app.get("/events", async (request, reply) =>
      sendResult(
        reply,
        await controller.events(getCompanyId(request), request.query),
      ),
    );

    // Access logs cross company boundaries, so they need the audit permission.
    app.get(
      "/access-logs",
      { preHandler: requireAuditManage },
      async (request, reply) =>
        sendResult(reply, await controller.accessLogs(request.query)),
    );
  };
}
