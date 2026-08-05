import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { InvestmentController } from "../financeiro/api/investment-controller.js";
import { getCompanyId } from "../identity/api/middlewares.js";
import { sendResult } from "./reply.js";

/**
 * Controllers of the Phase 4 investment endpoints, plus the shared auth hook.
 */
export interface InvestmentRoutesDependencies {
  investmentController: InvestmentController;
  authenticate: preHandlerHookHandler;
}

/**
 * Investment routes, mounted under /api/v1/investments.
 *
 * `/portfolio` is declared alongside `/:investmentId`; Fastify's radix router
 * prefers the static segment, so the order of registration does not matter.
 */
export function createInvestmentRoutes(
  deps: InvestmentRoutesDependencies,
): FastifyPluginAsync {
  const { investmentController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.register(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.list(getCompanyId(request), request.query),
      ),
    );

    app.get("/portfolio", async (request, reply) =>
      sendResult(
        reply,
        await controller.portfolio(getCompanyId(request), request.query),
      ),
    );

    app.get<{ Params: { investmentId: string } }>(
      "/:investmentId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.get(
            getCompanyId(request),
            request.params.investmentId,
            request.query,
          ),
        ),
    );

    app.put<{ Params: { investmentId: string } }>(
      "/:investmentId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.investmentId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { investmentId: string } }>(
      "/:investmentId/close",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.close(
            getCompanyId(request),
            request.params.investmentId,
          ),
        ),
    );

    app.post<{ Params: { investmentId: string } }>(
      "/:investmentId/operations",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.registerOperation(
            getCompanyId(request),
            request.params.investmentId,
            request.body,
          ),
        ),
    );

    app.get<{ Params: { investmentId: string } }>(
      "/:investmentId/operations",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.listOperations(
            getCompanyId(request),
            request.params.investmentId,
          ),
        ),
    );

    app.post<{ Params: { investmentId: string } }>(
      "/:investmentId/quotes",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.registerQuote(
            getCompanyId(request),
            request.params.investmentId,
            request.body,
          ),
        ),
    );

    app.get<{ Params: { investmentId: string } }>(
      "/:investmentId/quotes",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.listQuotes(
            getCompanyId(request),
            request.params.investmentId,
          ),
        ),
    );
  };
}
