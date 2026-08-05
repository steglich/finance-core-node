import { ValueObject } from "../../shared/domain/value-object.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { Money } from "./money.js";

/**
 * ExchangeRate value object.
 * Immutable conversion rate between two currencies on a given date (RN-07).
 */
export class ExchangeRate extends ValueObject {
  private readonly _sourceCurrency: string;
  private readonly _targetCurrency: string;
  private readonly _rate: number;
  private readonly _date: Date;

  constructor(
    sourceCurrency: string,
    targetCurrency: string,
    rate: number,
    date: Date,
  ) {
    super();

    const source = normalizeCurrency(sourceCurrency);
    const target = normalizeCurrency(targetCurrency);

    if (!isSupportedCurrency(source)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported source currency: ${sourceCurrency}`,
      );
    }

    if (!isSupportedCurrency(target)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported target currency: ${targetCurrency}`,
      );
    }

    if (source === target) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Exchange rate requires two different currencies",
      );
    }

    if (!Number.isFinite(rate) || rate <= 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Exchange rate must be a positive number, got: ${rate}`,
      );
    }

    if (Number.isNaN(date.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid exchange rate date");
    }

    this._sourceCurrency = source;
    this._targetCurrency = target;
    this._rate = rate;
    this._date = new Date(date.getTime());
  }

  get sourceCurrency(): string {
    return this._sourceCurrency;
  }

  get targetCurrency(): string {
    return this._targetCurrency;
  }

  get rate(): number {
    return this._rate;
  }

  get date(): Date {
    return new Date(this._date.getTime());
  }

  /**
   * Converts an amount in the source currency into the target currency.
   */
  convert(money: Money): Money {
    if (money.currency !== this._sourceCurrency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Cannot convert ${money.currency} using a ${this._sourceCurrency}/${this._targetCurrency} rate`,
      );
    }
    return Money.fromCents(money.cents * this._rate, this._targetCurrency);
  }

  /**
   * Returns the inverse rate (target -> source) for the same date.
   */
  invert(): ExchangeRate {
    return new ExchangeRate(
      this._targetCurrency,
      this._sourceCurrency,
      1 / this._rate,
      this._date,
    );
  }

  /**
   * Checks whether this rate can convert between the given currencies.
   */
  supports(sourceCurrency: string, targetCurrency: string): boolean {
    return (
      this._sourceCurrency === normalizeCurrency(sourceCurrency) &&
      this._targetCurrency === normalizeCurrency(targetCurrency)
    );
  }

  protected compareValues(): string {
    return `${this._sourceCurrency}:${this._targetCurrency}:${this._rate}:${this._date.toISOString()}`;
  }

  toJSON(): unknown {
    return {
      sourceCurrency: this._sourceCurrency,
      targetCurrency: this._targetCurrency,
      rate: this._rate,
      date: this._date.toISOString(),
    };
  }

  static create(
    sourceCurrency: string,
    targetCurrency: string,
    rate: number,
    date: Date,
  ): ExchangeRate {
    return new ExchangeRate(sourceCurrency, targetCurrency, rate, date);
  }
}
