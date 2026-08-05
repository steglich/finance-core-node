import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuthController } from "../identity/api/auth-controller.js";
import type { CompanyController } from "../identity/api/company-controller.js";
import type { ProfileController } from "../identity/api/profile-controller.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createCompanyRoutes } from "./company-routes.js";
import { createProfileRoutes } from "./profile-routes.js";
import {
  createAccountRoutes,
  createBudgetRoutes,
  createCardRoutes,
  createCategoryRoutes,
  createDashboardRoutes,
  createGoalRoutes,
  createInstallmentRoutes,
  createInvoiceRoutes,
  createRecurrenceRoutes,
  createReportRoutes,
  createTransactionRoutes,
  createTransferRoutes,
  type FinanceRoutesDependencies,
} from "./finance-routes.js";
import { createAuditRoutes } from "./audit-routes.js";
import type { AuditController } from "../auditoria/api/audit-controller.js";

export const API_PREFIX = "/api/v1";

/**
 * Everything the route tree needs, built by the composition root.
 */
export interface RouteDependencies extends Omit<
  FinanceRoutesDependencies,
  "authenticate"
> {
  authController: AuthController;
  auditController: AuditController;
  requireAuditManage: preHandlerHookHandler;
  companyController: CompanyController;
  profileController: ProfileController;
  authenticate: preHandlerHookHandler;
}

/**
 * Registers the whole route tree.
 *
 * Each bounded context is a Fastify plugin registered under its own prefix, so
 * hooks (auth, validation) stay encapsulated in the context that declares them.
 * Path matching is done by Fastify's radix router — order no longer matters.
 */
export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDependencies,
): Promise<void> {
  app.get("/", async () => ({ message: "Finance Core API is running!" }));

  await app.register(
    async (api) => {
      // identity
      await api.register(createAuthRoutes(deps.authController), {
        prefix: "/auth",
      });
      await api.register(
        createCompanyRoutes({
          controller: deps.companyController,
          authenticate: deps.authenticate,
        }),
        { prefix: "/companies" },
      );
      await api.register(
        createProfileRoutes({
          controller: deps.profileController,
          authenticate: deps.authenticate,
        }),
        { prefix: "/profiles" },
      );

      // financeiro
      await api.register(createAccountRoutes(deps), { prefix: "/accounts" });
      await api.register(createCategoryRoutes(deps), { prefix: "/categories" });
      await api.register(createTransactionRoutes(deps), {
        prefix: "/transactions",
      });
      await api.register(createInstallmentRoutes(deps), {
        prefix: "/installments",
      });
      await api.register(createTransferRoutes(deps), { prefix: "/transfers" });
      await api.register(createRecurrenceRoutes(deps), {
        prefix: "/recurrences",
      });
      await api.register(createCardRoutes(deps), { prefix: "/cards" });
      await api.register(createInvoiceRoutes(deps), { prefix: "/invoices" });
      await api.register(createBudgetRoutes(deps), { prefix: "/budgets" });
      await api.register(createGoalRoutes(deps), { prefix: "/goals" });
      await api.register(createDashboardRoutes(deps), { prefix: "/dashboard" });
      await api.register(createReportRoutes(deps), { prefix: "/reports" });

      // auditoria
      await api.register(
        createAuditRoutes({
          controller: deps.auditController,
          authenticate: deps.authenticate,
          requireAuditManage: deps.requireAuditManage,
        }),
        { prefix: "/audit" },
      );
    },
    { prefix: API_PREFIX },
  );
}
