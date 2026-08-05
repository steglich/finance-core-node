import { ValueObject } from "./value-object.js";
import { DomainError } from "./domain-error.js";

/**
 * Email value object.
 * Validates email format and ensures immutability.
 */
export class Email extends ValueObject {
  private readonly _value: string;

  constructor(value: string) {
    super();
    const normalized = value.toLowerCase().trim();

    if (!Email.isValidFormat(normalized)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid email format: ${value}`,
      );
    }

    this._value = normalized;
  }

  private static isValidFormat(email: string): boolean {
    // RFC 5322 simplified regex for basic validation
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return emailRegex.test(email) && email.length <= 254;
  }

  get value(): string {
    return this._value;
  }

  protected compareValues(): string {
    return this._value;
  }

  toJSON(): unknown {
    return this._value;
  }

  /**
   * Creates an Email instance from a string.
   */
  static create(value: string): Email {
    return new Email(value);
  }
}
