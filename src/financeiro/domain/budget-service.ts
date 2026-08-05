import type { Result } from "../../shared/domain/result.js";
import type { Budget, BudgetProgress } from "./budget.js";
import type { CategoryHierarchy } from "./category-hierarchy.js";
import type { Money } from "./money.js";

/**
 * Domain service that answers the two hierarchy questions a budget cannot answer
 * on its own, and delegates the comparison back to the aggregate.
 *
 * Kept free of I/O — the caller supplies the hierarchy and the actual amounts,
 * so the rollup rules are testable without a database.
 */
export class BudgetService {
  /**
   * The categories whose spending counts toward a budget on `categoryId`: the
   * category itself plus every descendant.
   */
  categoryScope(
    hierarchy: CategoryHierarchy,
    categoryId: string,
  ): string[] {
    return [
      categoryId,
      ...hierarchy.descendantsOf(categoryId).map((category) => category.id),
    ];
  }

  /**
   * Budgets that a transaction in `categoryId` moves: the budget on that exact
   * category and the budgets on any of its ancestors, since subcategory spending
   * rolls up into the parent.
   */
  budgetsAffectedBy(
    budgets: readonly Budget[],
    hierarchy: CategoryHierarchy,
    categoryId: string,
  ): Budget[] {
    const scope = new Set<string>([
      categoryId,
      ...hierarchy.ancestorsOf(categoryId).map((category) => category.id),
    ]);

    // A budget with no category dimension is not moved by a category alone.
    return budgets.filter(
      (budget) =>
        budget.isActive &&
        budget.categoryId !== undefined &&
        scope.has(budget.categoryId),
    );
  }

  /**
   * Re-evaluates a budget against its current actual amount, letting the
   * aggregate decide whether the exceeded alert fires.
   */
  evaluate(budget: Budget, actual: Money): Result<BudgetProgress> {
    return budget.evaluate(actual);
  }
}
