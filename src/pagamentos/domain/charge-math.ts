import { Money } from "../../financeiro/domain/money.js";
import { Percent } from "../../financeiro/domain/percent.js";

/**
 * Days a month is worth when interest is prorated. Fixed at 30 rather than the
 * real length of the month, which is what reproduces the documented example:
 * R$ 1.500 with 2% penalty and 1% monthly interest, 5 days late, comes to
 * R$ 1.532,50.
 */
export const INTEREST_DAYS_PER_MONTH = 30;

/**
 * Whole days between two dates, never negative.
 * Both ends are normalized to UTC midnight, so a difference in time of day
 * cannot add or drop a day.
 */
export function daysLate(dueDate: Date, referenceDate: Date): number {
  const due = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate(),
  );
  const reference = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );

  const days = Math.floor((reference - due) / 86_400_000);
  return days > 0 ? days : 0;
}

/**
 * One-off penalty charged as soon as the due date passes.
 * Zero while the charge is not late — the caller decides that by passing zero
 * days, or by not calling this at all.
 */
export function penaltyFor(original: Money, penaltyPercent: Percent): Money {
  if (penaltyPercent.isZero()) {
    return Money.zero(original.currency);
  }

  return penaltyPercent.applyTo(original);
}

/**
 * Interest prorated by day over a 30 day month:
 * `original x monthlyPercent / 30 x daysLate`.
 *
 * The whole expression is evaluated in cents and rounded only at the end, so
 * the fractions of a cent produced by the division do not accumulate.
 */
export function interestFor(
  original: Money,
  monthlyPercent: Percent,
  days: number,
): Money {
  if (monthlyPercent.isZero() || days <= 0) {
    return Money.zero(original.currency);
  }

  const cents =
    (original.cents * monthlyPercent.fraction * days) /
    INTEREST_DAYS_PER_MONTH;

  return Money.fromCents(cents, original.currency);
}

/**
 * The breakdown of what is due at a given date.
 */
export interface AmountsDue {
  original: Money;
  penalty: Money;
  interest: Money;
  totalDue: Money;
}

/**
 * Original amount plus penalty and interest for `days` of delay.
 * With no delay the total is the original amount, untouched.
 */
export function amountsDueFor(
  original: Money,
  penaltyPercent: Percent,
  monthlyInterestPercent: Percent,
  days: number,
): AmountsDue {
  const late = days > 0;
  const penalty = late
    ? penaltyFor(original, penaltyPercent)
    : Money.zero(original.currency);
  const interest = late
    ? interestFor(original, monthlyInterestPercent, days)
    : Money.zero(original.currency);

  return {
    original,
    penalty,
    interest,
    totalDue: original.add(penalty).add(interest),
  };
}
