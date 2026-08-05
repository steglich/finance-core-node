import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { getCompanyId } from "../identity/api/middlewares.js";
import type { ChargeController } from "../pagamentos/api/charge-controller.js";
import type { PayableController } from "../pagamentos/api/payable-controller.js";
import type { PixController } from "../pagamentos/api/pix-controller.js";
import { sendResult } from "./reply.js";

/**
 * Controllers of the pagamentos context, plus the shared auth hook.
 */
export interface PaymentRoutesDependencies {
  chargeController: ChargeController;
  payableController: PayableController;
  pixController: PixController;
  authenticate: preHandlerHookHandler;
}

/**
 * Charge routes, mounted under /api/v1/charges.
 */
export function createChargeRoutes(
  deps: PaymentRoutesDependencies,
): FastifyPluginAsync {
  const { chargeController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.issue(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.list(getCompanyId(request), request.query),
      ),
    );

    app.get<{ Params: { chargeId: string } }>(
      "/:chargeId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.get(getCompanyId(request), request.params.chargeId),
        ),
    );

    app.put<{ Params: { chargeId: string } }>(
      "/:chargeId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.chargeId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { chargeId: string } }>(
      "/:chargeId/receipts",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.receive(
            getCompanyId(request),
            request.params.chargeId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { chargeId: string } }>(
      "/:chargeId/cancel",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.cancel(
            getCompanyId(request),
            request.params.chargeId,
            request.body,
          ),
        ),
    );
  };
}

/**
 * Payable routes, mounted under /api/v1/payables.
 */
export function createPayableRoutes(
  deps: PaymentRoutesDependencies,
): FastifyPluginAsync {
  const { payableController: controller, authenticate } = deps;

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

    app.get<{ Params: { payableId: string } }>(
      "/:payableId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.get(getCompanyId(request), request.params.payableId),
        ),
    );

    app.put<{ Params: { payableId: string } }>(
      "/:payableId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.payableId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { payableId: string } }>(
      "/:payableId/payments",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.pay(
            getCompanyId(request),
            request.params.payableId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { payableId: string } }>(
      "/:payableId/cancel",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.cancel(
            getCompanyId(request),
            request.params.payableId,
            request.body,
          ),
        ),
    );
  };
}

/**
 * PIX routes, mounted under /api/v1/pix.
 */
export function createPixRoutes(
  deps: PaymentRoutesDependencies,
): FastifyPluginAsync {
  const { pixController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/send", async (request, reply) =>
      sendResult(
        reply,
        await controller.send(getCompanyId(request), request.body),
      ),
    );

    app.post("/receive", async (request, reply) =>
      sendResult(
        reply,
        await controller.receive(getCompanyId(request), request.body),
      ),
    );
  };
}
