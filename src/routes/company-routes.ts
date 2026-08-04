import type { IncomingMessage, ServerResponse } from "node:http";
import type { CompanyController } from "../identity/api/company-controller.js";

/**
 * Route definition.
 */
export interface Route {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

/**
 * Creates company routes for the given controller.
 */
export function createCompanyRoutes(controller: CompanyController): Route[] {
  return [
    {
      method: "POST",
      path: "/api/v1/companies",
      handler: (req, res) =>
        controller.create(req).then((result) => {
          sendResponse(res, result.statusCode, result.body);
        }),
    },
  ];
}

/**
 * Creates company user routes.
 */
export function createCompanyUserRoutes(
  controller: CompanyController,
): Route[] {
  return [
    {
      method: "POST",
      path: "/api/v1/companies/:companyId/users",
      handler: async (req, res) => {
        const companyId = extractParam(req.url, 4);
        if (!companyId) {
          sendResponse(res, 400, { error: "Invalid company ID" });
          return;
        }
        const result = await controller.inviteUser(companyId, req);
        sendResponse(res, result.statusCode, result.body);
      },
    },
    {
      method: "DELETE",
      path: "/api/v1/companies/:companyId/users/:userId",
      handler: async (req, res) => {
        const companyId = extractParam(req.url, 4);
        const userId = extractParam(req.url, 6);
        if (!companyId || !userId) {
          sendResponse(res, 400, { error: "Invalid parameters" });
          return;
        }
        const result = await controller.removeUser(companyId, userId);
        sendResponse(res, result.statusCode, result.body);
      },
    },
  ];
}

/**
 * Helper to extract URL parameter.
 */
function extractParam(
  url: string | undefined,
  index: number,
): string | undefined {
  if (!url) return undefined;
  const parts = url.split("/");
  return parts[index];
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
