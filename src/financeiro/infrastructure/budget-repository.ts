import type { Budget } from "../domain/budget.js";
import type { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Repository interface for the Budget aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant), except the
 * scheduler sweep, which crosses companies and carries the tenant on each row.
 */
export interface BudgetRepository {
  create(budget: Budget, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Budget | null>;

  /**
   * Budgets whose period overlaps the supplied window. Omit the window to get
   * every budget of the company.
   */
  findByCompanyAndPeriod(
    companyId: string,
    period?: { start: Date; end: Date },
    includeInactive?: boolean,
  ): Promise<Budget[]>;

  /**
   * Active budgets on a category, used by the event handler that re-evaluates
   * them after a transaction moves.
   */
  findActiveByCategory(
    companyId: string,
    categoryIds: readonly string[],
  ): Promise<Budget[]>;

  /**
   * Active budgets whose period has ended, across every company.
   */
  findPeriodsToClose(referenceDate: Date): Promise<Budget[]>;

  /**
   * Rejects a second active budget measuring the same thing over an
   * overlapping period. "The same thing" is the whole dimension combination:
   * a category budget and a cost center budget do not collide, and neither do
   * two category budgets under different cost centers.
   */
  existsOverlapping(
    companyId: string,
    dimensions: {
      categoryId?: string | undefined;
      costCenterId?: string | undefined;
    },
    period: { start: Date; end: Date },
    excludeBudgetId?: string,
  ): Promise<boolean>;

  update(budget: Budget, executor?: QueryExecutor): Promise<void>;

  /**
   * Amount actually spent: the net amount of the confirmed expenses of the
   * budget's category and its descendants inside the period. Derived on every
   * read — never stored (RN-02).
   */
  actualAmount(budget: Budget): Promise<Money>;
}
