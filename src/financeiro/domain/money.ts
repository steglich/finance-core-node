import { ValueObject } from "../../shared/domain/value-object.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";

/**
 * Number of decimal places used for every supported currency.
 * Matches the `decimal(15, 2)` columns used for monetary values in the database.
 */
const SCALE = 2;
const SCALE_FACTOR = 100;

/**
 * Rounds half away from zero, so that -0.005 becomes -0.01 (Math.round would give -0).
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Money value object.
 * Immutable amount + ISO 4217 currency, stored internally as an integer number of
 * minor units (cents) so arithmetic never suffers from floating point drift.
 */
export class Money extends ValueObject {
  private readonly _cents: number;
  private readonly _currency: string;

  constructor(amount: number, currency: string) {
    super();

    const normalizedCurrency = normalizeCurrency(currency);

    if (!isSupportedCurrency(normalizedCurrency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${currency}`,
      );
    }

    if (!Number.isFinite(amount)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid monetary amount: ${amount}`,
      );
    }

    const cents = amount * SCALE_FACTOR;

    // Reject amounts with more precision than the currency supports instead of
    // silently rounding user input. Use fromCents() when rounding is intended.
    if (Math.abs(cents - roundHalfAwayFromZero(cents)) > 1e-6) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Monetary amount ${amount} exceeds ${SCALE} decimal places`,
      );
    }

    this._cents = Money.assertSafeCents(roundHalfAwayFromZero(cents));
    this._currency = normalizedCurrency;
  }

  private static assertSafeCents(cents: number): number {
    if (!Number.isSafeInteger(cents)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Monetary amount is out of the supported range",
      );
    }
    return cents;
  }

  /**
   * Amount in major units (e.g. 12.34 for BRL).
   */
  get amount(): number {
    return this._cents / SCALE_FACTOR;
  }

  /**
   * Amount in minor units (e.g. 1234 for R$ 12,34).
   */
  get cents(): number {
    return this._cents;
  }

  get currency(): string {
    return this._currency;
  }

  private assertSameCurrency(other: Money): void {
    if (this._currency !== other._currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Currency mismatch: cannot operate on ${this._currency} and ${other._currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this._cents + other._cents, this._currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this._cents - other._cents, this._currency);
  }

  /**
   * Multiplies by a scalar factor, rounding half away from zero to the currency scale.
   */
  multiply(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid multiplication factor: ${factor}`,
      );
    }
    return Money.fromCents(
      roundHalfAwayFromZero(this._cents * factor),
      this._currency,
    );
  }

  /**
   * Divides by a scalar divisor, rounding half away from zero to the currency scale.
   */
  divide(divisor: number): Money {
    if (!Number.isFinite(divisor) || divisor === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid division divisor: ${divisor}`,
      );
    }
    return Money.fromCents(
      roundHalfAwayFromZero(this._cents / divisor),
      this._currency,
    );
  }

  negate(): Money {
    return Money.fromCents(-this._cents, this._currency);
  }

  abs(): Money {
    return Money.fromCents(Math.abs(this._cents), this._currency);
  }

  /**
   * Returns -1, 0 or 1 comparing this amount with another of the same currency.
   */
  compareTo(other: Money): number {
    this.assertSameCurrency(other);
    if (this._cents < other._cents) return -1;
    if (this._cents > other._cents) return 1;
    return 0;
  }

  greaterThan(other: Money): boolean {
    return this.compareTo(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compareTo(other) >= 0;
  }

  lessThan(other: Money): boolean {
    return this.compareTo(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compareTo(other) <= 0;
  }

  isZero(): boolean {
    return this._cents === 0;
  }

  isPositive(): boolean {
    return this._cents > 0;
  }

  isNegative(): boolean {
    return this._cents < 0;
  }

  /**
   * Fixed-scale decimal string, suitable for persistence (e.g. "1234.50").
   */
  toDecimalString(): string {
    return this.amount.toFixed(SCALE);
  }

  protected compareValues(): string {
    return `${this._currency}:${this._cents}`;
  }

  toJSON(): unknown {
    return {
      amount: this.amount,
      currency: this._currency,
    };
  }

  /**
   * Creates a Money instance from an amount in major units.
   */
  static create(amount: number, currency: string): Money {
    return new Money(amount, currency);
  }

  /**
   * Creates a Money instance from an amount in minor units (cents).
   */
  static fromCents(cents: number, currency: string): Money {
    const rounded = Money.assertSafeCents(roundHalfAwayFromZero(cents));
    return new Money(rounded / SCALE_FACTOR, currency);
  }

  /**
   * Creates a Money instance from a decimal string as returned by the database.
   */
  static fromDecimalString(value: string, currency: string): Money {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid monetary value: ${value}`,
      );
    }
    return Money.fromCents(parsed * SCALE_FACTOR, currency);
  }

  static zero(currency: string): Money {
    return new Money(0, currency);
  }

  /**
   * Sums a list of amounts of the same currency.
   */
  static sum(currency: string, values: readonly Money[]): Money {
    return values.reduce<Money>(
      (total, value) => total.add(value),
      Money.zero(currency),
    );
  }
}
