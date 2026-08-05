import { DomainError } from "../../shared/domain/domain-error.js";
import { addDays, addMonths, daysInMonth, toUtcDate } from "./date-math.js";

/**
 * Pure billing-cycle math. Kept out of the entities so it can be tested without
 * a database and so an invoice can materialize its dates once, immune to a later
 * change of the card's closing day.
 */

function assertCycleDay(day: number, label: string): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw DomainError.create(
      "VALIDATION_ERROR",
      `${label} must be an integer between 1 and 31`,
    );
  }
}

/**
 * The nominal day of a month, clamped to the last day when the month is short
 * (closing day 31 in February → the 28th, or the 29th in a leap year).
 */
function dayInMonth(year: number, monthIndex: number, day: number): Date {
  return new Date(
    Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex))),
  );
}

/**
 * Closing date of the cycle that contains `date`: the first occurrence of the
 * card's closing day on or after `date`. A purchase made after the closing date
 * therefore falls into the next cycle.
 */
export function closingDateFor(date: Date, closingDay: number): Date {
  assertCycleDay(closingDay, "Closing day");

  const base = toUtcDate(date);
  const thisMonth = dayInMonth(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    closingDay,
  );

  if (base.getTime() <= thisMonth.getTime()) {
    return thisMonth;
  }

  const next = addMonths(base, 1);
  return dayInMonth(next.getUTCFullYear(), next.getUTCMonth(), closingDay);
}

/**
 * First day of the cycle that ends on `closingDate` — the day after the previous
 * closing date.
 */
export function cycleStartFor(closingDate: Date, closingDay: number): Date {
  assertCycleDay(closingDay, "Closing day");

  const previous = addMonths(toUtcDate(closingDate), -1);
  return addDays(
    dayInMonth(previous.getUTCFullYear(), previous.getUTCMonth(), closingDay),
    1,
  );
}

/**
 * Due date derived from the card's due day: the month following the closing
 * date, or the same month when the due day is later than the closing day.
 */
export function dueDateFor(closingDate: Date, dueDay: number): Date {
  assertCycleDay(dueDay, "Due day");

  const base = toUtcDate(closingDate);
  const sameMonth = dayInMonth(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    dueDay,
  );

  if (sameMonth.getTime() > base.getTime()) {
    return sameMonth;
  }

  const next = addMonths(base, 1);
  return dayInMonth(next.getUTCFullYear(), next.getUTCMonth(), dueDay);
}
