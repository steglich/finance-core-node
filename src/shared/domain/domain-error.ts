/**
 * Error codes for domain errors.
 */
export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "ENTITY_NOT_FOUND"
  | "DUPLICATE_ENTITY"
  | "INVALID_OPERATION"
  | "BUSINESS_RULE_VIOLATION"
  | "UNAUTHORIZED_ACCESS"
  | "COMPANY_CONTEXT_REQUIRED"
  | "UNAUTHORIZED"
  | "NOT_IMPLEMENTED";

/**
 * Base class for all domain errors.
 * Domain errors represent business rule violations or invalid operations,
 * not infrastructure failures.
 */
export class DomainError extends Error {
  private readonly _code: DomainErrorCode;
  private readonly _details?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this._code = code;
    this._details = details;
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, DomainError.prototype);
  }

  get code(): DomainErrorCode {
    return this._code;
  }

  get details(): unknown {
    return this._details;
  }

  /**
   * Creates a new domain error with the given parameters.
   */
  static create(
    code: DomainErrorCode,
    message: string,
    details?: unknown,
  ): DomainError {
    return new DomainError(code, message, details);
  }

  /**
   * Throws the error if condition is true.
   * Note: Does not return 'never' to avoid TypeScript control flow issues.
   */
  static throwIf(
    condition: boolean,
    code: DomainErrorCode,
    message: string,
  ): void {
    if (condition) {
      throw new DomainError(code, message);
    }
  }
}
