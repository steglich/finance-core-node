import { ValueObject } from "../../shared/domain/value-object.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Money } from "./money.js";

/**
 * Percent value object.
 * Immutable percentage between 0 and 100.
 */
export class Percent extends ValueObject {
  private readonly _value: number;

  constructor(value: number) {
    super();

    if (!Number.isFinite(value)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid percentage: ${value}`,
      );
    }

    if (value < 0 || value > 100) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Percentage must be between 0 and 100, got: ${value}`,
      );
    }

    this._value = value;
  }

  /**
   * Percentage in the 0-100 range.
   */
  get value(): number {
    return this._value;
  }

  /**
   * Percentage as a 0-1 fraction.
   */
  get fraction(): number {
    return this._value / 100;
  }

  isZero(): boolean {
    return this._value === 0;
  }

  /**
   * Applies the percentage to a monetary amount, rounding to the currency scale.
   */
  applyTo(money: Money): Money {
    return money.multiply(this.fraction);
  }

  protected compareValues(): string {
    return String(this._value);
  }

  toJSON(): unknown {
    return this._value;
  }

  static create(value: number): Percent {
    return new Percent(value);
  }

  /**
   * Creates a Percent from a 0-1 fraction.
   */
  static fromFraction(fraction: number): Percent {
    return new Percent(fraction * 100);
  }

  static zero(): Percent {
    return new Percent(0);
  }
}
