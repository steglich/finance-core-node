import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isQuantityBearing } from "./investment-operation.js";
import type { InvestmentOperation } from "./investment-operation.js";
import { Money } from "./money.js";

/**
 * Quantities are compared with a tolerance rather than exactly: they are
 * decimal(20,8) values, so a sale of the whole position must not be rejected
 * because of the eighth decimal place.
 */
const QUANTITY_EPSILON = 1e-8;

/**
 * The position derived from an investment's operations. Nothing here is stored
 * — recomputing it from the operations is always the answer (design, decision 3).
 */
export interface InvestmentPosition {
  /** Bought minus sold. */
  quantity: number;
  /** Remaining cost divided by remaining quantity; zero on an empty position. */
  averageCost: number;
  /** Cost of the quantity still held. */
  investedAmount: Money;
  /** Profit or loss already crystallized by sales. */
  realizedResult: Money;
  /** Dividends, interest and amortizations received. */
  incomeReceived: Money;
}

/**
 * The position priced at a reference date.
 */
export interface InvestmentValuation extends InvestmentPosition {
  currentValue: Money;
  /** Current value minus the cost still invested. */
  unrealizedResult: Money;
  /** (current + realized + income − invested) ÷ invested, as a percentage. */
  profitabilityPercent: number;
  /** False when the current value fell back to the invested amount. */
  quoted: boolean;
}

function isNearlyZero(value: number): boolean {
  return Math.abs(value) <= QUANTITY_EPSILON;
}

/**
 * Derives the position from the operations of a single investment.
 *
 * Cost is average, not FIFO (declared as such in the design): a sale reduces
 * the invested cost by the sold quantity valued at the average cost, and the
 * difference against the sale amount becomes the realized result. Because the
 * policy is average cost, the result does not depend on the order of the buys —
 * but sales do consume the position, so the list must be chronological.
 */
export function derivePosition(
  operations: readonly InvestmentOperation[],
  currency: string,
): Result<InvestmentPosition> {
  let quantity = 0;
  let investedAmount = Money.zero(currency);
  let realizedResult = Money.zero(currency);
  let incomeReceived = Money.zero(currency);

  for (const operation of operations) {
    if (operation.currency !== currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Operation ${operation.id} is in ${operation.currency}, not ${currency}`,
        ),
      );
    }

    if (!isQuantityBearing(operation.operationType)) {
      incomeReceived = incomeReceived.add(operation.amount);
      continue;
    }

    if (operation.operationType === "BUY") {
      quantity += operation.quantity;
      investedAmount = investedAmount.add(operation.amount);
      continue;
    }

    // SELL
    if (operation.quantity - quantity > QUANTITY_EPSILON) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Insufficient quantity: selling ${operation.quantity} of a position of ${quantity}`,
        ),
      );
    }

    // The whole position leaving takes the whole remaining cost with it, so no
    // rounding residue can survive a full exit.
    const soldCost = isNearlyZero(quantity - operation.quantity)
      ? investedAmount
      : investedAmount.multiply(operation.quantity / quantity);

    realizedResult = realizedResult.add(operation.amount.subtract(soldCost));
    investedAmount = investedAmount.subtract(soldCost);
    quantity -= operation.quantity;

    if (isNearlyZero(quantity)) {
      quantity = 0;
    }
  }

  return Result.success({
    quantity,
    averageCost: isNearlyZero(quantity) ? 0 : investedAmount.amount / quantity,
    investedAmount,
    realizedResult,
    incomeReceived,
  });
}

/**
 * Prices a position.
 *
 * Without a quote the current value falls back to the invested amount and the
 * result says so through `quoted: false` — better than zero, which would erase
 * real wealth, and better than an error, which would break the dashboard of
 * anyone who has not registered a quote yet (design, decision 8).
 */
export function valuePosition(
  position: InvestmentPosition,
  unitPrice: number | undefined,
): InvestmentValuation {
  const currency = position.investedAmount.currency;

  const quoted = unitPrice !== undefined && unitPrice > 0;
  const currentValue = quoted
    ? Money.fromCents(position.quantity * unitPrice * 100, currency)
    : position.investedAmount;

  const unrealizedResult = currentValue.subtract(position.investedAmount);

  const total = currentValue
    .add(position.realizedResult)
    .add(position.incomeReceived)
    .subtract(position.investedAmount);

  // An investment that cost nothing has no base to be profitable against, so
  // it reports zero instead of dividing by zero.
  const profitabilityPercent = position.investedAmount.isZero()
    ? 0
    : (total.cents / position.investedAmount.cents) * 100;

  return {
    ...position,
    currentValue,
    unrealizedResult,
    profitabilityPercent,
    quoted,
  };
}
