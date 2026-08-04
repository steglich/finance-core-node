import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProfileController } from "../identity/api/profile-controller.js";
import { sendResponse } from "./company-routes.js";

/**
 * Route definition.
 */
export interface Route {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

/**
 * Creates profile routes for the given controller.
 */
export function createProfileRoutes(controller: ProfileController): Route[] {
  return [
    {
      method: "GET",
      path: "/api/v1/profiles",
      handler: async (_req, res) => {
        // This would need companyId from auth middleware in real implementation
        const result = await controller.list("");
        sendResponse(res, result.statusCode, result.body);
      },
    },
    {
      method: "POST",
      path: "/api/v1/profiles",
      handler: async (req, res) => {
        // This would need companyId from auth middleware in real implementation
        const result = await controller.create("", req);
        sendResponse(res, result.statusCode, result.body);
      },
    },
  ];
}
