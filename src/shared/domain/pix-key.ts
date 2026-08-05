import { CNPJ } from "./cnpj.js";
import { CPF } from "./cpf.js";
import { DomainError } from "./domain-error.js";
import { Email } from "./email.js";
import { ValueObject } from "./value-object.js";

/**
 * The five key kinds accepted by the Brazilian instant payment system.
 */
export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const RANDOM_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * PIX key value object.
 * Infers the key type from the given format, validates it with the matching
 * primitive (`CPF`, `CNPJ`, `Email`) and stores the normalized, unmasked value.
 *
 * A phone key must carry its country code (`+5511999999999`) — without it an
 * eleven digit number is indistinguishable from a CPF.
 */
export class PixKey extends ValueObject {
  private readonly _value: string;
  private readonly _type: PixKeyType;

  constructor(value: string) {
    super();
    const raw = value.trim();

    if (raw.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "PIX key cannot be empty");
    }

    if (raw.includes("@")) {
      this._type = "EMAIL";
      this._value = Email.create(raw).value;
      return;
    }

    if (raw.startsWith("+")) {
      const phone = raw.replace(/[\s().-]/g, "");
      if (!PHONE_PATTERN.test(phone)) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          `Invalid PIX phone key: ${value}`,
        );
      }
      this._type = "PHONE";
      this._value = phone;
      return;
    }

    const lowered = raw.toLowerCase();
    if (RANDOM_PATTERN.test(lowered)) {
      this._type = "RANDOM";
      this._value = lowered;
      return;
    }

    const digits = raw.replace(/[.\-/]/g, "");
    if (/^\d{11}$/.test(digits)) {
      this._type = "CPF";
      this._value = CPF.create(digits).value;
      return;
    }

    if (/^\d{14}$/.test(digits)) {
      this._type = "CNPJ";
      this._value = CNPJ.create(digits).value;
      return;
    }

    throw DomainError.create(
      "VALIDATION_ERROR",
      `Invalid PIX key: ${value}. Expected a CPF, CNPJ, email, phone with country code or random key`,
    );
  }

  get value(): string {
    return this._value;
  }

  get type(): PixKeyType {
    return this._type;
  }

  protected compareValues(): string {
    return `${this._type}:${this._value}`;
  }

  toJSON(): unknown {
    return { value: this._value, type: this._type };
  }

  /**
   * Creates a PIX key from a string, inferring its type.
   */
  static create(value: string): PixKey {
    return new PixKey(value);
  }
}
