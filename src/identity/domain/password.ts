import { ValueObject } from "../../shared/domain/value-object.js";
import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * Password value object.
 * Validates password requirements (length, complexity) without storing the actual hash.
 * The hashed version is stored in the database via PasswordService.
 */
export class Password extends ValueObject {
  private readonly _value: string;

  constructor(value: string) {
    super();

    if (!Password.isValid(value)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Invalid password: must be at least 8 characters, contain at least one uppercase letter, one lowercase letter, and one number",
      );
    }

    this._value = value;
  }

  private static isValid(password: string): boolean {
    if (password.length < 8) return false;
    if (!/[A-Z]/.test(password)) return false; // At least one uppercase
    if (!/[a-z]/.test(password)) return false; // At least one lowercase
    if (!/\d/.test(password)) return false; // At least one number
    return true;
  }

  get value(): string {
    return this._value;
  }

  protected compareValues(): string {
    return this._value;
  }

  toJSON(): unknown {
    return undefined; // Never expose password in JSON
  }

  /**
   * Creates a Password instance from a plain string.
   */
  static create(value: string): Password {
    return new Password(value);
  }

  /**
   * Validates that a plain text password matches a hashed version.
   * This method is meant to be used by PasswordService, not directly here.
   */
  static validateComparison(plainText: string, hashed: string): boolean {
    // Placeholder - actual implementation should use bcrypt/argon2 via PasswordService
    throw new Error("Use PasswordService.verify() for password comparison");
  }
}
