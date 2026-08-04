import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthController } from "../identity/api/auth-controller.js";
import type { CompanyController } from "../identity/api/company-controller.js";
import type { ProfileController } from "../identity/api/profile-controller.js";
import { createAuthRoutes, type Route as AuthRoute } from "./auth-routes.js";
import {
  createCompanyRoutes,
  createCompanyUserRoutes,
  type Route as CompanyRoute,
} from "./company-routes.js";
import {
  createProfileRoutes,
  type Route as ProfileRoute,
} from "./profile-routes.js";

/**
 * All routes combined.
 */
export type Route = AuthRoute | CompanyRoute | ProfileRoute;

/**
 * Router configuration with all controllers.
 */
export interface RouterConfig {
  authController: AuthController;
  companyController: CompanyController;
  profileController: ProfileController;
}

/**
 * Creates all routes for the given controllers.
 */
export function createRoutes(config: RouterConfig): Route[] {
  const routes: Route[] = [];

  // Add auth routes
  routes.push(...createAuthRoutes(config.authController));

  // Add company routes
  routes.push(...createCompanyRoutes(config.companyController));
  routes.push(...createCompanyUserRoutes(config.companyController));

  // Add profile routes
  routes.push(...createProfileRoutes(config.profileController));

  return routes;
}

/**
 * Finds and executes the matching route.
 */
export async function handleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  routes: Route[],
): Promise<boolean> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // Find matching route (order matters - more specific paths first)
  for (const route of routes) {
    if (route.method !== method) continue;

    const matchResult = matchPath(route.path, url);
    if (!matchResult) continue;

    await route.handler(req, res);
    return true;
  }

  // No route matched - check for health endpoint
  if (method === "GET" && url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Finance Core API is running!" }));
    return true;
  }

  // Not found
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
  return false;
}

/**
 * Matches a route pattern against an actual URL.
 * Supports :param syntax for dynamic segments.
 */
function matchPath(pattern: string, url: string): boolean {
  const patternParts = pattern.split("/");
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const urlParts = (url.split("?")[0] ?? "").split("/");

  if (patternParts.length !== urlParts.length) {
    return false;
  }

  for (let i = 0; i < patternParts.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const patternPart = patternParts[i]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const urlPart = urlParts[i]!;

    // :param matches any value
    if (patternPart.startsWith(":")) continue;

    // Exact match required for non-param segments
    if (patternPart !== urlPart) return false;
  }

  return true;
}
