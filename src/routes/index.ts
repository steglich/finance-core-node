import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuthController } from "../identity/api/auth-controller.js";
import type { CompanyController } from "../identity/api/company-controller.js";
import type { ProfileController } from "../identity/api/profile-controller.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createCompanyRoutes } from "./company-routes.js";
import { createProfileRoutes } from "./profile-routes.js";

export const API_PREFIX = "/api/v1";

/**
 * Everything the route tree needs, built by the composition root.
 */
export interface RouteDependencies {
  authController: AuthController;
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
    },
    { prefix: API_PREFIX },
  );
}
