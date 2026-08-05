import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { CostCenterController } from "../cadastros/api/cost-center-controller.js";
import type {
  ListPeopleQuery,
  PersonController,
} from "../cadastros/api/person-controller.js";
import { getCompanyId } from "../identity/api/middlewares.js";
import type { LedgerController } from "../pagamentos/api/ledger-controller.js";
import { sendResult } from "./reply.js";

/**
 * Controllers of the cadastros context, plus the shared auth hook.
 */
export interface RegistrationRoutesDependencies {
  personController: PersonController;
  costCenterController: CostCenterController;
  ledgerController: LedgerController;
  authenticate: preHandlerHookHandler;
}

/**
 * People routes, mounted under /api/v1/people.
 *
 * The roles and bank-account sub-resources are nested here rather than in their
 * own plugin: both only exist inside a person.
 */
export function createPeopleRoutes(
  deps: RegistrationRoutesDependencies,
): FastifyPluginAsync {
  const { personController: controller, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.create(getCompanyId(request), request.body),
      ),
    );

    app.get<{ Querystring: ListPeopleQuery }>("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.list(getCompanyId(request), request.query),
      ),
    );

    app.get<{ Params: { personId: string } }>(
      "/:personId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.get(getCompanyId(request), request.params.personId),
        ),
    );

    app.put<{ Params: { personId: string } }>(
      "/:personId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.personId,
            request.body,
          ),
        ),
    );

    app.delete<{ Params: { personId: string } }>(
      "/:personId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.deactivate(
            getCompanyId(request),
            request.params.personId,
          ),
        ),
    );

    app.post<{ Params: { personId: string } }>(
      "/:personId/roles",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.addRole(
            getCompanyId(request),
            request.params.personId,
            request.body,
          ),
        ),
    );

    app.delete<{ Params: { personId: string; role: string } }>(
      "/:personId/roles/:role",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.removeRole(
            getCompanyId(request),
            request.params.personId,
            request.params.role,
          ),
        ),
    );

    app.post<{ Params: { personId: string } }>(
      "/:personId/bank-accounts",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.addBankAccount(
            getCompanyId(request),
            request.params.personId,
            request.body,
          ),
        ),
    );

    app.get<{ Params: { personId: string } }>(
      "/:personId/bank-accounts",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.listBankAccounts(
            getCompanyId(request),
            request.params.personId,
          ),
        ),
    );

    app.put<{ Params: { personId: string; bankAccountId: string } }>(
      "/:personId/bank-accounts/:bankAccountId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.updateBankAccount(
            getCompanyId(request),
            request.params.personId,
            request.params.bankAccountId,
            request.body,
          ),
        ),
    );

    app.delete<{ Params: { personId: string; bankAccountId: string } }>(
      "/:personId/bank-accounts/:bankAccountId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.deleteBankAccount(
            getCompanyId(request),
            request.params.personId,
            request.params.bankAccountId,
          ),
        ),
    );
  };
}

/**
 * Customer routes, mounted under /api/v1/customers.
 * Customers are a filter over people, not a separate resource.
 */
export function createCustomerRoutes(
  deps: RegistrationRoutesDependencies,
): FastifyPluginAsync {
  const { personController: controller, ledgerController, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.listByRole(getCompanyId(request), "CUSTOMER"),
      ),
    );

    app.get<{ Params: { personId: string } }>(
      "/:personId/ledger",
      async (request, reply) =>
        sendResult(
          reply,
          await ledgerController.customer(
            getCompanyId(request),
            request.params.personId,
          ),
        ),
    );
  };
}

/**
 * Supplier routes, mounted under /api/v1/suppliers.
 */
export function createSupplierRoutes(
  deps: RegistrationRoutesDependencies,
): FastifyPluginAsync {
  const { personController: controller, ledgerController, authenticate } = deps;

  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.get("/", async (request, reply) =>
      sendResult(
        reply,
        await controller.listByRole(getCompanyId(request), "SUPPLIER"),
      ),
    );

    app.get<{ Params: { personId: string } }>(
      "/:personId/ledger",
      async (request, reply) =>
        sendResult(
          reply,
          await ledgerController.supplier(
            getCompanyId(request),
            request.params.personId,
          ),
        ),
    );
  };
}

/**
 * Cost center routes, mounted under /api/v1/cost-centers.
 */
export function createCostCenterRoutes(
  deps: RegistrationRoutesDependencies,
): FastifyPluginAsync {
  const { costCenterController: controller, authenticate } = deps;

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
          await controller.list(getCompanyId(request), request.query),
        ),
    );

    app.get<{ Params: { costCenterId: string } }>(
      "/:costCenterId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.get(
            getCompanyId(request),
            request.params.costCenterId,
          ),
        ),
    );

    app.put<{ Params: { costCenterId: string } }>(
      "/:costCenterId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.update(
            getCompanyId(request),
            request.params.costCenterId,
            request.body,
          ),
        ),
    );

    app.delete<{ Params: { costCenterId: string } }>(
      "/:costCenterId",
      async (request, reply) =>
        sendResult(
          reply,
          await controller.deactivate(
            getCompanyId(request),
            request.params.costCenterId,
          ),
        ),
    );
  };
}
