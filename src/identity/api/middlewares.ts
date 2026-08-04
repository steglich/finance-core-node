import type { IncomingMessage } from "node:http";
import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * Request context with authenticated user info.
 */
export interface RequestContext {
  userId: string;
  companyId: string;
}

/**
 * Auth middleware that validates JWT and injects user context.
 */
export class AuthMiddleware {
  constructor(
    private readonly jwtTokenService: {
      verifyAccessToken: (token: string) => {
        userId: string;
        companyId: string;
      };
    },
  ) {}

  async execute(
    req: IncomingMessage,
  ): Promise<
    | { continue: true; context: RequestContext }
    | { continue: false; error: DomainError }
  > {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        continue: false,
        error: DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "Authorization header missing or invalid",
        ),
      };
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    try {
      const decoded = this.jwtTokenService.verifyAccessToken(token);
      return {
        continue: true,
        context: { userId: decoded.userId, companyId: decoded.companyId },
      };
    } catch (error) {
      return {
        continue: false,
        error: DomainError.create(
          "UNAUTHORIZED_ACCESS",
          error instanceof Error ? error.message : "Invalid token",
        ),
      };
    }
  }
}

/**
 * Permission requirement.
 */
export type PermissionRequirement = {
  resource: string;
  action: "READ" | "WRITE" | "DELETE" | "MANAGE";
};

/**
 * Middleware factory for permission checking.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function requirePermission(
  _permission: PermissionRequirement,
): (
  req: IncomingMessage,
) => Promise<
  | { continue: true; context: RequestContext }
  | { continue: false; error: DomainError }
> {
  // Note: This is a placeholder implementation. In a real system, you'd check
  // the user's profile permissions from the database.
  return async (req: IncomingMessage) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        continue: false,
        error: DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "Authorization header missing or invalid",
        ),
      };
    }

    // For now, just pass through - actual permission checking would go here
    return {
      continue: true,
      context: { userId: "", companyId: "" }, // Would be extracted from token in real impl
    };
  };
}

/**
 * Combines multiple middlewares into one.
 */
export async function chainMiddlewares(
  req: IncomingMessage,
  middlewareFns: ((
    req: IncomingMessage,
  ) => Promise<
    | { continue: true; context: RequestContext }
    | { continue: false; error: DomainError }
  >)[],
): Promise<
  | { continue: true; context?: RequestContext }
  | { continue: false; error: DomainError }
> {
  let context: RequestContext | undefined;

  for (const middleware of middlewareFns) {
    const result = await middleware(req);

    if (!result.continue) {
      return { continue: false, error: result.error };
    }

    // Extract context from the first successful auth middleware
    if ("context" in result && result.context !== undefined) {
      context = result.context;
    }
  }

  // Return with or without context based on whether we have one
  if (context !== undefined) {
    return { continue: true, context };
  }
  return { continue: true };
}
