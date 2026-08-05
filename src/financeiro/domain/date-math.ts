/**
 * Date helpers shared by installment generation and recurrence scheduling.
 * All operations work on UTC calendar dates — financial due dates have no time
 * component and must not shift with the server timezone.
 */

/**
 * Normalizes a date to midnight UTC, dropping any time component.
 */
export function toUtcDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Number of days in a given month, accounting for leap years.
 */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds `days` calendar days.
 */
export function addDays(date: Date, days: number): Date {
  const base = toUtcDate(date);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Adds `months` calendar months, clamping the day to the last day of the target
 * month. Jan 31 + 1 month → Feb 28 (or Feb 29 in a leap year), never Mar 3.
 */
export function addMonths(date: Date, months: number): Date {
  const base = toUtcDate(date);
  const year = base.getUTCFullYear();
  const monthIndex = base.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(
    base.getUTCDate(),
    daysInMonth(targetYear, targetMonth),
  );
  return new Date(Date.UTC(targetYear, targetMonth, day));
}

/**
 * Adds `years` calendar years, clamping Feb 29 to Feb 28 on non-leap years.
 */
export function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12);
}
