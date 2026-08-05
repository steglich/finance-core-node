import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { addDays, addMonths, toUtcDate } from "./date-math.js";
import type { Periodicity, Recurrence } from "./recurrence.js";

/**
 * How much each periodicity advances per occurrence.
 * Month-based periodicities go through addMonths, which clamps the day to the
 * last day of the target month (Jan 31 → Feb 29 in a leap year), and always
 * measure from the start date so the anchor day never drifts.
 */
const STEP: Readonly<Record<Periodicity, { unit: "day" | "month"; size: number }>> =
  {
    DAILY: { unit: "day", size: 1 },
    WEEKLY: { unit: "day", size: 7 },
    BIWEEKLY: { unit: "day", size: 14 },
    MONTHLY: { unit: "month", size: 1 },
    QUARTERLY: { unit: "month", size: 3 },
    SEMIANNUAL: { unit: "month", size: 6 },
    ANNUAL: { unit: "month", size: 12 },
  };

/**
 * Stateless domain service that computes recurrence schedules.
 */
export class RecurrenceService {
  /**
   * Date of the nth occurrence (0-based) counted from the start date.
   */
  occurrenceDate(
    startDate: Date,
    periodicity: Periodicity,
    index: number,
  ): Date {
    const step = STEP[periodicity];
    return step.unit === "day"
      ? addDays(startDate, step.size * index)
      : addMonths(startDate, step.size * index);
  }

  /**
   * Next date the recurrence should generate a transaction for, or undefined
   * when it is finished (end date reached, max occurrences hit, or not active).
   */
  nextOccurrence(recurrence: Recurrence): Date | undefined {
    if (!recurrence.isActive) {
      return undefined;
    }

    const max = recurrence.maxOccurrences;
    if (max !== undefined && recurrence.generatedCount >= max) {
      return undefined;
    }

    const next = this.occurrenceDate(
      recurrence.startDate,
      recurrence.periodicity,
      recurrence.generatedCount,
    );

    const endDate = recurrence.endDate;
    if (endDate && next.getTime() > endDate.getTime()) {
      return undefined;
    }

    return next;
  }

  /**
   * Occurrences that are due up to (and including) `referenceDate` and have not
   * been generated yet — what the scheduler needs to catch up on.
   */
  dueOccurrences(recurrence: Recurrence, referenceDate: Date): Date[] {
    const limit = toUtcDate(referenceDate);
    const due: Date[] = [];

    if (!recurrence.isActive) {
      return due;
    }

    const max = recurrence.maxOccurrences;
    const endDate = recurrence.endDate;

    for (
      let index = recurrence.generatedCount;
      max === undefined || index < max;
      index += 1
    ) {
      const date = this.occurrenceDate(
        recurrence.startDate,
        recurrence.periodicity,
        index,
      );

      if (date.getTime() > limit.getTime()) {
        break;
      }
      if (endDate && date.getTime() > endDate.getTime()) {
        break;
      }

      due.push(date);
    }

    return due;
  }

  /**
   * Whether the recurrence has no future occurrence left to generate.
   */
  isExhausted(recurrence: Recurrence): boolean {
    return this.nextOccurrence(recurrence) === undefined;
  }

  /**
   * All occurrence dates within a window, useful for projections.
   */
  scheduleBetween(
    startDate: Date,
    periodicity: Periodicity,
    from: Date,
    to: Date,
  ): Result<Date[]> {
    const start = toUtcDate(startDate);
    const windowStart = toUtcDate(from);
    const windowEnd = toUtcDate(to);

    if (windowEnd.getTime() < windowStart.getTime()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "Window end date must not be earlier than the start date",
        ),
      );
    }

    const dates: Date[] = [];
    for (let index = 0; ; index += 1) {
      const date = this.occurrenceDate(start, periodicity, index);
      if (date.getTime() > windowEnd.getTime()) {
        break;
      }
      if (date.getTime() >= windowStart.getTime()) {
        dates.push(date);
      }
    }

    return Result.success(dates);
  }
}
