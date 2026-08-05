import { addMonths, toUtcDate } from "./date-math.js";
import { Money } from "./money.js";

/**
 * One line of the amortization schedule, with the interest and principal
 * portions frozen at contract time.
 */
export interface ScheduleLine {
  number: number;
  dueDate: Date;
  amount: Money;
  interestAmount: Money;
  principalAmount: Money;
}

export interface BuildScheduleInput {
  principal: Money;
  /** Monthly rate in the 0-100 range, as the contract states it. */
  monthlyRatePercent: number;
  installmentCount: number;
  installmentAmount: Money;
  firstDueDate: Date;
}

/**
 * Builds the amortization schedule of a loan.
 *
 * For each installment: `interest = round(balance × rate)`, `principal =
 * installment − interest`, and the balance drops by that principal. The last
 * installment takes whatever principal is left and derives its interest from
 * it, so the principal portions add up to the contracted principal **to the
 * cent** — without that, a loan ends with a few cents of phantom balance, which
 * is the classic defect of this calculation (design, decision 6).
 *
 * The installment amount is informed, not derived: the real contract has it
 * printed, and recomputing it by the Price formula would produce cents the
 * user's bank never charged.
 *
 * Due dates come from `date-math.ts`, the same helper the recurrences use, so
 * "the 31st in February" resolves one way in the whole system.
 */
export function buildSchedule(input: BuildScheduleInput): ScheduleLine[] {
  const {
    principal,
    monthlyRatePercent,
    installmentCount,
    installmentAmount,
    firstDueDate,
  } = input;

  const currency = principal.currency;
  const rate = monthlyRatePercent / 100;
  const firstDue = toUtcDate(firstDueDate);

  const lines: ScheduleLine[] = [];
  let balance = principal;

  for (let number = 1; number <= installmentCount; number += 1) {
    const dueDate = addMonths(firstDue, number - 1);
    const isLast = number === installmentCount;

    let principalPortion: Money;
    let interestPortion: Money;

    if (isLast) {
      // The last installment absorbs the rounding: it repays exactly what is
      // left, and its interest is whatever the installment amount does not.
      principalPortion = balance;
      interestPortion = installmentAmount.subtract(principalPortion);
    } else {
      interestPortion = balance.multiply(rate);
      principalPortion = installmentAmount.subtract(interestPortion);
    }

    lines.push({
      number,
      dueDate,
      amount: installmentAmount,
      interestAmount: interestPortion,
      principalAmount: principalPortion,
    });

    balance = balance.subtract(principalPortion);
  }

  return lines;
}

/**
 * Sums the principal portions of a schedule — used by the contract guard and
 * by the tests that pin the "to the cent" invariant.
 */
export function totalPrincipal(
  lines: readonly ScheduleLine[],
  currency: string,
): Money {
  return Money.sum(
    currency,
    lines.map((line) => line.principalAmount),
  );
}
