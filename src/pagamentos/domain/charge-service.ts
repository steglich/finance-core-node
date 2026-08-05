import { Money } from "../../financeiro/domain/money.js";
import type { AmountsDue } from "./charge-math.js";
import type { Charge } from "./charge.js";

/**
 * Read-side domain service over charges.
 *
 * It holds no state and touches no repository: the amounts owed are a function
 * of the charge and the date, and this is where callers that only need the
 * numbers (ledgers, listings, dashboards) go for them.
 */
export class ChargeService {
  /**
   * Original amount, penalty, interest and total due at `referenceDate`.
   */
  amountsDueAt(charge: Charge, referenceDate: Date): AmountsDue {
    return charge.amountsDueAt(referenceDate);
  }

  /**
   * Total still owed across a set of charges at `referenceDate`.
   * Settled and cancelled charges contribute nothing.
   */
  outstandingTotal(
    charges: readonly Charge[],
    referenceDate: Date,
    currency: string,
  ): Money {
    return charges
      .filter((charge) => charge.isOpen)
      .reduce(
        (total, charge) =>
          total.add(this.amountsDueAt(charge, referenceDate).totalDue),
        Money.zero(currency),
      );
  }
}
