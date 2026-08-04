import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthController } from "../identity/api/auth-controller.js";

/**
 * Route handler function type.
 */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

/**
 * Route definition.
 */
export interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

/**
 * Creates auth routes for the given controller.
 */
export function createAuthRoutes(controller: AuthController): Route[] {
  return [
    {
      method: "POST",
      path: "/api/v1/auth/register",
      handler: async (req, res) => {
        const result = await controller.register(req);
        sendResponse(res, result.statusCode, result.body);
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/login",
      handler: async (req, res) => {
        const result = await controller.login(req);
        sendResponse(res, result.statusCode, result.body);
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/refresh",
      handler: async (req, res) => {
        const result = await controller.refresh(req);
        sendResponse(res, result.statusCode, result.body);
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/recover-password",
      handler: async (req, res) => {
        const result = await controller.recoverPassword(req);
        sendResponse(res, result.statusCode, result.body);
      },
    },
    {
      method: "POST",
      path: "/api/v1/auth/reset-password",
      handler: async (req, res) => {
        const result = await controller.resetPassword(req);
        sendResponse(res, result.statusCode, result.body);
      },
    },
  ];
}

/**
 * Helper to send JSON response.
 */
export function sendResponse(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
