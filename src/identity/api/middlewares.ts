import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { JwtTokenService } from "../infrastructure/jwt-token-service.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import type {
  PermissionAction,
  PermissionResource,
} from "../domain/profile.js";

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
 * Repositories needed to resolve the permissions of the active profile.
 */
export interface PermissionDependencies {
  companyRepository: CompanyRepository;
  profileRepository: ProfileRepository;
}

/**
 * Creates a `requirePermission(resource, action)` factory bound to the given
 * repositories. Register the returned hook after `authenticate`: it resolves
 * the profile the user holds in the company carried by the token and rejects
 * the request when that profile lacks the permission.
 */
export function createRequirePermission(deps: PermissionDependencies) {
  return (
    resource: PermissionResource,
    action: PermissionAction,
  ): preHandlerHookHandler => {
    return async (request) => {
      const { userId, companyId } = getAuthContext(request);

      const profileId = await deps.companyRepository.findUserProfileId(
        companyId,
        userId,
      );
      if (!profileId) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "User has no profile in the active company",
        );
      }

      const profile = await deps.profileRepository.findById(profileId);
      if (!profile) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "Active profile not found",
        );
      }

      const allowed = profile.permissions.some(
        (permission) =>
          permission.resource === resource &&
          (permission.action === action || permission.action === "MANAGE"),
      );

      if (!allowed) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          `Profile lacks permission ${action} on ${resource}`,
        );
      }
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
