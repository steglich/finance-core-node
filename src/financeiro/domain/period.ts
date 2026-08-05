import { ValueObject } from "../../shared/domain/value-object.js";
import { DomainError } from "../../shared/domain/domain-error.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Period value object.
 * Immutable closed date interval where startDate <= endDate.
 */
export class Period extends ValueObject {
  private readonly _startDate: Date;
  private readonly _endDate: Date;

  constructor(startDate: Date, endDate: Date) {
    super();

    if (Number.isNaN(startDate.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid period start date");
    }

    if (Number.isNaN(endDate.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid period end date");
    }

    if (startDate.getTime() > endDate.getTime()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Period start date must be earlier than or equal to the end date",
      );
    }

    this._startDate = new Date(startDate.getTime());
    this._endDate = new Date(endDate.getTime());
  }

  get startDate(): Date {
    return new Date(this._startDate.getTime());
  }

  get endDate(): Date {
    return new Date(this._endDate.getTime());
  }

  /**
   * Number of days covered by the period, counting both ends.
   */
  get days(): number {
    const elapsed = this._endDate.getTime() - this._startDate.getTime();
    return Math.floor(elapsed / MILLISECONDS_PER_DAY) + 1;
  }

  /**
   * Checks whether a date falls within the period (inclusive on both ends).
   */
  contains(date: Date): boolean {
    const time = date.getTime();
    return (
      time >= this._startDate.getTime() && time <= this._endDate.getTime()
    );
  }

  /**
   * Checks whether this period shares at least one instant with another.
   */
  overlaps(other: Period): boolean {
    return (
      this._startDate.getTime() <= other._endDate.getTime() &&
      other._startDate.getTime() <= this._endDate.getTime()
    );
  }

  protected compareValues(): string {
    return `${this._startDate.toISOString()}:${this._endDate.toISOString()}`;
  }

  toJSON(): unknown {
    return {
      startDate: this._startDate.toISOString(),
      endDate: this._endDate.toISOString(),
    };
  }

  static create(startDate: Date, endDate: Date): Period {
    return new Period(startDate, endDate);
  }
}
