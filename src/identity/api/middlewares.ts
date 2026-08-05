import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { JwtTokenService } from "../infrastructure/jwt-token-service.js";

/**
 * Request context with authenticated user info.
 */
export interface RequestContext {
  userId: string;
  companyId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by the `authenticate` preHandler on protected routes. */
    authContext?: RequestContext;
  }
}

/**
 * Creates the preHandler that validates the Bearer token and injects the
 * request context. Register it on every protected route.
 */
export function createAuthenticate(
  jwtTokenService: JwtTokenService,
): preHandlerHookHandler {
  return async (request) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw DomainError.create(
        "UNAUTHORIZED_ACCESS",
        "Authorization header missing or invalid",
      );
    }

    const token = authHeader.substring("Bearer ".length);
    const decoded = jwtTokenService.verifyAccessToken(token);

    request.authContext = {
      userId: decoded.userId,
      companyId: decoded.companyId,
    };
  };
}

/**
 * Reads the authenticated context. Throws when the route was not protected by
 * `createAuthenticate`, so a missing context can never silently become an
 * empty company scope.
 */
export function getAuthContext(request: FastifyRequest): RequestContext {
  const context = request.authContext;
  if (!context) {
    throw DomainError.create(
      "UNAUTHORIZED_ACCESS",
      "Authentication is required for this route",
    );
  }
  return context;
}

/**
 * Reads the company scope of the authenticated request.
 */
export function getCompanyId(request: FastifyRequest): string {
  const { companyId } = getAuthContext(request);
  if (!companyId) {
    throw DomainError.create(
      "COMPANY_CONTEXT_REQUIRED",
      "No company selected for this token",
    );
  }
  return companyId;
}
