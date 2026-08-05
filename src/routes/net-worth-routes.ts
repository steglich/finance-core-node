import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { ExchangeRateController } from "../financeiro/api/exchange-rate-controller.js";
import type { NetWorthController } from "../financeiro/api/net-worth-controller.js";
import { getAuthContext, getCompanyId } from "../identity/api/middlewares.js";
import { sendResult } from "./reply.js";

/**
 * Controllers of the Phase 4 net worth and exchange rate endpoints.
 */
export interface NetWorthRoutesDependencies {
  netWorthController: NetWorthController;
  exchangeRateController: ExchangeRateController;
  authenticate: preHandlerHookHandler;
}

/**
 * Net worth routes, mounted under /api/v1/net-worth.
 */
export function createNetWorthRoutes(
  deps: NetWorthRoutesDependencies,
): FastifyPluginAsync {
  const { netWorthController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.get(getCompanyId(request), request.query),
      ),
    );

    app.get("/evolution", async (request, reply) =>
      sendResult(
        reply,
        await controller.evolution(getCompanyId(request), request.query),
      ),
    );

    // The only route that reads across companies — and it takes the user from
    // the token, so the set of companies is the user's own memberships.
    app.get("/consolidated", async (request, reply) =>
      sendResult(
        reply,
        await controller.consolidated(
          getAuthContext(request).userId,
          getCompanyId(request),
          request.query,
        ),
      ),
    );
  };
}

/**
 * Exchange rate routes, mounted under /api/v1/exchange-rates.
 */
export function createExchangeRateRoutes(
  deps: NetWorthRoutesDependencies,
): FastifyPluginAsync {
  const { exchangeRateController: controller, authenticate } = deps;

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
  };
}
