import { ValueObject } from "./value-object.js";
import { DomainError } from "./domain-error.js";

/**
 * CNPJ (Cadastro Nacional da Pessoa Jurídica) value object.
 * Validates Brazilian corporate taxpayer registry number format and check digits.
 */
export class CNPJ extends ValueObject {
  private readonly _value: string;

  constructor(value: string) {
    super();
    const cleanValue = CNPJ.clean(value);

    if (!CNPJ.isValid(cleanValue)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid CNPJ number: ${value}`,
      );
    }

    this._value = cleanValue;
  }

  private static clean(value: string): string {
    return value.replace(/[.\-/]/g, "");
  }

  private static isValid(cnpj: string): boolean {
    // Must have exactly 14 digits
    if (cnpj.length !== 14 || !/^\d+$/.test(cnpj)) {
      return false;
    }

    // Reject all same digits
    if (/^(\d)\1+$/.test(cnpj)) {
      return false;
    }

    const chars = [...cnpj];

    // First check digit - use at() method which is safer with strict mode
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const weight = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2][i]!;
      sum += Number(chars.at(i)!) * weight;
    }
    const remainder = sum % 11;
    const firstCheck = remainder < 2 ? 0 : 11 - remainder;

    if (firstCheck !== Number(chars.at(12)!)) {
      return false;
    }

    // Second check digit
    sum = 0;
    for (let i = 0; i < 13; i++) {
      const weight = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2][i]!;
      sum += Number(chars.at(i)!) * weight;
    }
    const remainder2 = sum % 11;
    const secondCheck = remainder2 < 2 ? 0 : 11 - remainder2;

    return secondCheck === Number(chars.at(13)!);
  }

  get value(): string {
    return this._value;
  }

  get formatted(): string {
    return `${this._value.slice(0, 2)}.${this._value.slice(2, 6)}.${this._value.slice(6, 10)}/${this._value.slice(10)}-${this._value.slice(12)}`;
  }

  protected compareValues(): string {
    return this._value;
  }

  toJSON(): unknown {
    return this._value;
  }

  /**
   * Creates a CNPJ instance from a string.
   */
  static create(value: string): CNPJ {
    return new CNPJ(value);
  }
}
