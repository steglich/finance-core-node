import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { Logger } from "../../shared/infrastructure/logger.js";
import type { BudgetService } from "../domain/budget-service.js";
import { CategoryHierarchy } from "../domain/category-hierarchy.js";
import type { BudgetRepository } from "./budget-repository.js";
import type { CategoryRepository } from "./category-repository.js";
import type { TransactionRepository } from "./transaction-repository.js";

/**
 * Events that change how much has been spent in a category.
 */
const SPENDING_EVENTS = [
  "TransactionPosted",
  "TransactionRefunded",
  "TransactionCancelled",
] as const;

export interface BudgetEventHandlerDependencies {
  budgetRepository: BudgetRepository;
  categoryRepository: CategoryRepository;
  transactionRepository: TransactionRepository;
  budgetService: BudgetService;
  eventBus: DomainEventBus;
  logger: Logger;
}

/**
 * Re-evaluates the budgets a transaction touches whenever its confirmed amount
 * changes.
 *
 * Registering a transaction stays unaware of budgets — the category classifies,
 * it does not change behaviour (RN-06) — so the coupling lives here, on the same
 * bus the audit trail already uses.
 */
export function registerBudgetHandlers(
  deps: BudgetEventHandlerDependencies,
): void {
  const {
    budgetRepository,
    categoryRepository,
    transactionRepository,
    budgetService,
    eventBus,
    logger,
  } = deps;

  const reevaluate = async (event: DomainEvent<string>): Promise<void> => {
    const companyId = (event as unknown as { companyId?: string }).companyId;
    if (!companyId) {
      return;
    }

    const transaction = await transactionRepository.findById(
      companyId,
      String(event.aggregateId),
    );

    const categoryId = transaction?.categoryId;
    if (!transaction || !categoryId) {
      return;
    }

    const categories = await categoryRepository.findByCompanyId(companyId);
    const hierarchy = new CategoryHierarchy(categories);

    // A budget on an ancestor also counts this spending, so the lookup walks up.
    const candidateIds = [
      categoryId,
      ...hierarchy.ancestorsOf(categoryId).map((category) => category.id),
    ];

    const budgets = await budgetRepository.findActiveByCategory(
      companyId,
      candidateIds,
    );

    for (const budget of budgetService.budgetsAffectedBy(
      budgets,
      hierarchy,
      categoryId,
    )) {
      const actual = await budgetRepository.actualAmount(budget);
      const evaluated = budgetService.evaluate(budget, actual);

      if (evaluated.isFailure) {
        continue;
      }

      await budgetRepository.update(budget);

      for (const raised of budget.events) {
        eventBus.publish(raised);
      }
      budget.clearEvents();
    }
  };

  for (const eventType of SPENDING_EVENTS) {
    eventBus.subscribe(eventType, (event: DomainEvent<string>) => {
      // The bus is synchronous: a budget re-evaluation must never break the
      // request that produced the transaction.
      void reevaluate(event).catch((error: unknown) => {
        logger.error(
          `Failed to re-evaluate budgets for ${eventType}: ${String(error)}`,
        );
      });
    });
  }
}
