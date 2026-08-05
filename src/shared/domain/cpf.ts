import { ValueObject } from "../../shared/domain/value-object.js";
import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * CPF (Cadastro de Pessoas Físicas) value object.
 * Validates Brazilian individual taxpayer registry number format and check digits.
 */
export class CPF extends ValueObject {
  private readonly _value: string;

  constructor(value: string) {
    super();
    const cleanValue = CPF.clean(value);

    if (!CPF.isValid(cleanValue)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid CPF number: ${value}`,
      );
    }

    this._value = cleanValue;
  }

  private static clean(value: string): string {
    return value.replace(/[.\-/]/g, "");
  }

  private static isValid(cpf: string): boolean {
    // Must have exactly 11 digits
    if (cpf.length !== 11 || !/^\d+$/.test(cpf)) {
      return false;
    }

    // Reject all same digits (e.g., 111.111.111-11)
    if (/^(\d)\1+$/.test(cpf)) {
      return false;
    }

    const chars = [...cpf];

    // First check digit - use at() method which is safer with strict mode
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += Number(chars.at(i)!) * (10 - i);
    }
    const remainder = (sum * 10) % 11;
    const firstCheck = remainder === 10 ? 0 : remainder;

    if (firstCheck !== Number(chars.at(9)!)) {
      return false;
    }

    // Second check digit
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += Number(chars.at(i)!) * (11 - i);
    }
    const remainder2 = (sum * 10) % 11;
    const secondCheck = remainder2 === 10 ? 0 : remainder2;

    return secondCheck === Number(chars.at(10)!);
  }

  get value(): string {
    return this._value;
  }

  get formatted(): string {
    return `${this._value.slice(0, 3)}.${this._value.slice(3, 6)}.${this._value.slice(6, 9)}-${this._value.slice(9)}`;
  }

  protected compareValues(): string {
    return this._value;
  }

  toJSON(): unknown {
    return this._value;
  }

  /**
   * Creates a CPF instance from a string.
   */
  static create(value: string): CPF {
    return new CPF(value);
  }
}
