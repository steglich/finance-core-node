import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { AccountController } from "../financeiro/api/account-controller.js";
import type { BudgetController } from "../financeiro/api/budget-controller.js";
import type { CardController } from "../financeiro/api/card-controller.js";
import type { DashboardController } from "../financeiro/api/dashboard-controller.js";
import type { GoalController } from "../financeiro/api/goal-controller.js";
import type { InvoiceController } from "../financeiro/api/invoice-controller.js";
import type { ReportController } from "../financeiro/api/report-controller.js";
import type { CategoryController } from "../financeiro/api/category-controller.js";
import type { InstallmentController } from "../financeiro/api/installment-controller.js";
import type { RecurrenceController } from "../financeiro/api/recurrence-controller.js";
import type { TransactionController } from "../financeiro/api/transaction-controller.js";
import type { TransferController } from "../financeiro/api/transfer-controller.js";
import { getCompanyId } from "../identity/api/middlewares.js";
import { sendResult } from "./reply.js";

/**
 * Controllers of the financeiro context, plus the shared auth hook.
 */
export interface FinanceRoutesDependencies {
  accountController: AccountController;
  categoryController: CategoryController;
  transactionController: TransactionController;
  installmentController: InstallmentController;
  transferController: TransferController;
  recurrenceController: RecurrenceController;
  cardController: CardController;
  invoiceController: InvoiceController;
  budgetController: BudgetController;
  goalController: GoalController;
  dashboardController: DashboardController;
  reportController: ReportController;
  authenticate: preHandlerHookHandler;
}

/**
 * Account routes, mounted under /api/v1/accounts.
 */
export function createAccountRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { accountController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get<{ Querystring: { includeInactive?: string } }>(
      "/",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.list(
            getCompanyId(request),
            request.query.includeInactive === "true",
          ),
        ),
    );

    app.get<{ Params: { accountId: string } }>(
      "/:accountId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.detail(
            getCompanyId(request),
            request.params.accountId,
          ),
        ),
    );

    app.put<{ Params: { accountId: string } }>(
      "/:accountId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.accountId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { accountId: string } }>(
      "/:accountId/deactivate",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.deactivate(
            getCompanyId(request),
            request.params.accountId,
          ),
        ),
    );
  };
}

/**
 * Category routes, mounted under /api/v1/categories.
 */
export function createCategoryRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { categoryController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(reply, await controller.list(getCompanyId(request))),
    );

    app.put<{ Params: { categoryId: string } }>(
      "/:categoryId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.categoryId,
            request.body,
          ),
        ),
    );

    app.delete<{ Params: { categoryId: string } }>(
      "/:categoryId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.delete(
            getCompanyId(request),
            request.params.categoryId,
          ),
        ),
    );

    app.post<{ Params: { categoryId: string } }>(
      "/:categoryId/move",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.move(
            getCompanyId(request),
            request.params.categoryId,
            request.body,
          ),
        ),
    );
  };
}

/**
 * Transaction routes, mounted under /api/v1/transactions.
 */
export function createTransactionRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { transactionController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.list(getCompanyId(request), request.query),
      ),
    );

    app.get<{ Params: { transactionId: string } }>(
      "/:transactionId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.detail(
            getCompanyId(request),
            request.params.transactionId,
          ),
        ),
    );

    app.put<{ Params: { transactionId: string } }>(
      "/:transactionId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.transactionId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { transactionId: string } }>(
      "/:transactionId/confirm",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.confirm(
            getCompanyId(request),
            request.params.transactionId,
          ),
        ),
    );

    app.post<{ Params: { transactionId: string } }>(
      "/:transactionId/cancel",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.cancel(
            getCompanyId(request),
            request.params.transactionId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { transactionId: string } }>(
      "/:transactionId/refund",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.refund(
            getCompanyId(request),
            request.params.transactionId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { transactionId: string } }>(
      "/:transactionId/attachments",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.addAttachment(
            getCompanyId(request),
            request.params.transactionId,
            request.body,
          ),
        ),
    );

    app.get<{ Params: { transactionId: string; attachmentId: string } }>(
      "/:transactionId/attachments/:attachmentId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.getAttachment(
            getCompanyId(request),
            request.params.transactionId,
            request.params.attachmentId,
          ),
        ),
    );
  };
}

/**
 * Installment routes, mounted under /api/v1/installments.
 */
export function createInstallmentRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { installmentController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.list(getCompanyId(request), request.query),
      ),
    );

    app.post("/pay", async (request, reply) =>
      sendResult(
        reply,
        await controller.payBatch(getCompanyId(request), request.body),
      ),
    );

    app.put<{ Params: { installmentId: string } }>(
      "/:installmentId/due-date",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.changeDueDate(
            getCompanyId(request),
            request.params.installmentId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { installmentId: string } }>(
      "/:installmentId/pay",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.pay(
            getCompanyId(request),
            request.params.installmentId,
            request.body,
          ),
        ),
    );
  };
}

/**
 * Transfer routes, mounted under /api/v1/transfers.
 */
export function createTransferRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { transferController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );
  };
}

/**
 * Recurrence routes, mounted under /api/v1/recurrences.
 */
export function createRecurrenceRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { recurrenceController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(reply, await controller.list(getCompanyId(request))),
    );

    app.put<{ Params: { recurrenceId: string } }>(
      "/:recurrenceId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.recurrenceId,
            request.body,
          ),
        ),
    );

    for (const operation of ["pause", "resume", "cancel"] as const) {
      app.post<{ Params: { recurrenceId: string } }>(
        `/:recurrenceId/${operation}`,
        async (request, reply) =>
          sendResult(
            reply,
            await controller[operation](
              getCompanyId(request),
              request.params.recurrenceId,
            ),
          ),
      );
    }
  };
}

/**
 * Card routes, mounted under /api/v1/cards. The card's invoices hang off the
 * card itself, since an invoice only exists inside a card's cycle.
 */
export function createCardRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const {
    cardController: controller,
    invoiceController: invoices,
    authenticate,
  } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get<{ Querystring: { includeInactive?: string } }>(
      "/",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.list(
            getCompanyId(request),
            request.query.includeInactive === "true",
          ),
        ),
    );

    app.get<{ Params: { cardId: string } }>(
      "/:cardId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.detail(getCompanyId(request), request.params.cardId),
        ),
    );

    app.put<{ Params: { cardId: string } }>(
      "/:cardId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.edit(
            getCompanyId(request),
            request.params.cardId,
            request.body,
          ),
        ),
    );

    app.delete<{ Params: { cardId: string } }>(
      "/:cardId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.deactivate(
            getCompanyId(request),
            request.params.cardId,
          ),
        ),
    );

    app.get<{ Params: { cardId: string } }>(
      "/:cardId/invoices",
      async (request, reply) =>
        sendResult(
          reply,
          await invoices.listByCard(
            getCompanyId(request),
            request.params.cardId,
          ),
        ),
    );

    app.post<{ Params: { cardId: string } }>(
      "/:cardId/invoices/close",
      async (request, reply) =>
        sendResult(
          reply,
          await invoices.close(getCompanyId(request), request.params.cardId),
        ),
    );
  };
}

/**
 * Invoice routes, mounted under /api/v1/invoices.
 */
export function createInvoiceRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { invoiceController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get<{ Params: { invoiceId: string } }>(
      "/:invoiceId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.detail(
            getCompanyId(request),
            request.params.invoiceId,
          ),
        ),
    );

    app.post<{ Params: { invoiceId: string } }>(
      "/:invoiceId/payments",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.pay(
            getCompanyId(request),
            request.params.invoiceId,
            request.body,
          ),
        ),
    );
  };
}

/**
 * Budget routes, mounted under /api/v1/budgets.
 */
export function createBudgetRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { budgetController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.list(getCompanyId(request), request.query),
      ),
    );

    app.get<{ Params: { budgetId: string } }>(
      "/:budgetId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.detail(
            getCompanyId(request),
            request.params.budgetId,
          ),
        ),
    );

    app.put<{ Params: { budgetId: string } }>(
      "/:budgetId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.edit(
            getCompanyId(request),
            request.params.budgetId,
            request.body,
          ),
        ),
    );

    app.delete<{ Params: { budgetId: string } }>(
      "/:budgetId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.deactivate(
            getCompanyId(request),
            request.params.budgetId,
          ),
        ),
    );
  };
}

/**
 * Goal routes, mounted under /api/v1/goals.
 */
export function createGoalRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { goalController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get("/", async (request, reply) =>
      sendResult(reply, await controller.list(getCompanyId(request))),
    );

    app.get<{ Params: { goalId: string } }>(
      "/:goalId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.detail(getCompanyId(request), request.params.goalId),
        ),
    );

    app.put<{ Params: { goalId: string } }>(
      "/:goalId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.edit(
            getCompanyId(request),
            request.params.goalId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { goalId: string } }>(
      "/:goalId/contributions",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.contribute(
            getCompanyId(request),
            request.params.goalId,
            request.body,
          ),
        ),
    );

    app.post<{ Params: { goalId: string } }>(
      "/:goalId/cancel",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.cancel(getCompanyId(request), request.params.goalId),
        ),
    );
  };
}

/**
 * Dashboard route, mounted under /api/v1/dashboard.
 */
export function createDashboardRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { dashboardController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.overview(getCompanyId(request), request.query),
      ),
    );
  };
}

/**
 * Report routes, mounted under /api/v1/reports.
 */
export function createReportRoutes(
  deps: FinanceRoutesDependencies,
): FastifyPluginAsync {
  const { reportController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get<{ Params: { type: string } }>("/:type", async (request, reply) =>
      sendResult(
        reply,
        await controller.generate(
          getCompanyId(request),
          request.params.type,
          request.query,
        ),
      ),
    );

    app.get<{ Params: { type: string } }>(
      "/:type/export",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.export(
            getCompanyId(request),
            request.params.type,
            request.query,
          ),
        ),
    );
  };
}
