import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { LoanController } from "../financeiro/api/loan-controller.js";
import { getCompanyId } from "../identity/api/middlewares.js";
import { sendResult } from "./reply.js";

/**
 * Controllers of the Phase 4 loan endpoints, plus the shared auth hook.
 */
export interface LoanRoutesDependencies {
  loanController: LoanController;
  authenticate: preHandlerHookHandler;
}

/**
 * Loan routes, mounted under /api/v1/loans.
 */
export function createLoanRoutes(
  deps: LoanRoutesDependencies,
): FastifyPluginAsync {
  const { loanController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.contract(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.list(getCompanyId(request), request.query),
      ),
    );

    app.get<{ Params: { loanId: string } }>(
      "/:loanId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.get(getCompanyId(request), request.params.loanId),
        ),
    );

    app.put<{ Params: { loanId: string } }>(
      "/:loanId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.loanId,
            request.body,
          ),
        ),
    );

    app.get<{ Params: { loanId: string } }>(
      "/:loanId/installments",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.listInstallments(
            getCompanyId(request),
            request.params.loanId,
          ),
        ),
    );

    app.post<{ Params: { loanId: string; number: string } }>(
      "/:loanId/installments/:number/payments",
      async (request, reply) => {
        const number = Number(request.params.number);
        if (!Number.isInteger(number) || number < 1) {
          return reply
            .code(400)
            .send({ error: "The installment number must be a positive integer" });
        }

        return sendResult(
          reply,
          await controller.payInstallment(
            getCompanyId(request),
            request.params.loanId,
            number,
            request.body,
          ),
        );
      },
    );

    app.post<{ Params: { loanId: string } }>(
      "/:loanId/amortizations",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.amortize(
            getCompanyId(request),
            request.params.loanId,
            request.body,
          ),
        ),
    );
  };
}
