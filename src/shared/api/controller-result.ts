import type { DomainErrorCode } from "../domain/domain-error.js";

/**
 * Result returned by every controller method.
 * Controllers never touch the HTTP response — the route sends it.
 */
export interface ControllerResult<T = unknown> {
  statusCode: number;
  body: T;
}

/**
 * Maps a domain error code to its HTTP status code.
 */
export function toHttpStatusCode(code: DomainErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
    case "INVALID_OPERATION":
    case "BUSINESS_RULE_VIOLATION":
    case "COMPANY_CONTEXT_REQUIRED":
      return 400;
    case "UNAUTHORIZED_ACCESS":
    case "UNAUTHORIZED":
      return 401;
    case "ENTITY_NOT_FOUND":
      return 404;
    case "DUPLICATE_ENTITY":
      return 409;
    default:
      return 500;
  }
}
