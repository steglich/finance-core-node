import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { Budget } from "../domain/budget.js";
import type { BudgetRepository } from "../infrastructure/budget-repository.js";
import type { CostCenterRepository } from "../../cadastros/infrastructure/cost-center-repository.js";
import type { CategoryRepository } from "../infrastructure/category-repository.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import {
  validateCreateBudgetRequest,
  validateDashboardQuery,
  validateEditBudgetRequest,
} from "./dtos.js";

/**
 * Budget endpoints. The amount spent is always derived from the transactions of
 * the category and its descendants — it is never a stored, editable field.
 */
export class BudgetController {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly accountRepository: AccountRepository,
    private readonly eventBus: DomainEventBus,
    private readonly costCenterRepository?: CostCenterRepository,
  ) {}

  /**
   * POST /api/v1/budgets
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateBudgetRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    // A budget carries a category, a cost center, or both.
    let category;
    if (input.categoryId) {
      category = await this.categoryRepository.findById(
        companyId,
        input.categoryId,
      );
      if (!category) {
        return { statusCode: 404, body: { error: "Category not found" } };
      }
    }

    if (input.costCenterId && this.costCenterRepository) {
      const costCenter = await this.costCenterRepository.findById(
        companyId,
        input.costCenterId,
      );
      if (!costCenter) {
        return { statusCode: 404, body: { error: "Cost center not found" } };
      }
      if (!costCenter.isActive) {
        return {
          statusCode: 400,
          body: { error: "Inactive cost centers cannot be budgeted" },
        };
      }
    }

    // Two active budgets measuring the same combination over the same window
    // would make the progress ambiguous.
    const duplicated = await this.budgetRepository.existsOverlapping(
      companyId,
      { categoryId: input.categoryId, costCenterId: input.costCenterId },
      { start: input.periodStart, end: input.periodEnd },
    );
    if (duplicated) {
      return {
        statusCode: 409,
        body: {
          error:
            "An active budget already exists for this combination in an overlapping period",
        },
      };
    }

    const currency =
      input.currency ?? (await this.defaultCurrency(companyId));

    const result = Budget.create({
      companyId,
      category,
      costCenterId: input.costCenterId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      plannedAmount: input.plannedAmount,
      currency,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const budget = result.value;
    await this.budgetRepository.create(budget);
    this.publish(budget);

    return { statusCode: 201, body: await this.present(budget) };
  }

  /**
   * GET /api/v1/budgets — budgets of a period with their progress.
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateDashboardQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const budgets = await this.budgetRepository.findByCompanyAndPeriod(
      companyId,
      { start: validation.data.start, end: validation.data.end },
    );

    return {
      statusCode: 200,
      body: {
        budgets: await Promise.all(
          budgets.map((budget) => this.present(budget)),
        ),
      },
    };
  }

  /**
   * GET /api/v1/budgets/:budgetId
   */
  async detail(companyId: string, budgetId: string): Promise<ControllerResult> {
    const budget = await this.budgetRepository.findById(companyId, budgetId);
    if (!budget) {
      return { statusCode: 404, body: { error: "Budget not found" } };
    }

    return { statusCode: 200, body: await this.present(budget) };
  }

  /**
   * PUT /api/v1/budgets/:budgetId
   */
  async edit(
    companyId: string,
    budgetId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateEditBudgetRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const budget = await this.budgetRepository.findById(companyId, budgetId);
    if (!budget) {
      return { statusCode: 404, body: { error: "Budget not found" } };
    }

    const result = budget.edit(validation.data);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.budgetRepository.update(budget);
    this.publish(budget);

    return { statusCode: 200, body: await this.present(budget) };
  }

  /**
   * DELETE /api/v1/budgets/:budgetId — deactivates; budgets are never deleted.
   */
  async deactivate(
    companyId: string,
    budgetId: string,
  ): Promise<ControllerResult> {
    const budget = await this.budgetRepository.findById(companyId, budgetId);
    if (!budget) {
      return { statusCode: 404, body: { error: "Budget not found" } };
    }

    const result = budget.deactivate();
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.budgetRepository.update(budget);

    return { statusCode: 200, body: budget.toJSON() };
  }

  /**
   * Budget as returned by the API: the stored fields plus the derived progress.
   */
  private async present(budget: Budget): Promise<Record<string, unknown>> {
    const actual =
      budget.frozenActualAmount ??
      (await this.budgetRepository.actualAmount(budget));

    const progress = budget.progress(actual);

    return {
      ...(budget.toJSON() as Record<string, unknown>),
      actualAmount: actual.amount,
      remaining: progress.value?.remaining.amount ?? 0,
      percentUsed: progress.value?.percentUsed ?? 0,
      exceeded: progress.value?.exceeded ?? false,
    };
  }

  /**
   * A budget has no account of its own, so it adopts the currency the company
   * already operates in.
   */
  private async defaultCurrency(companyId: string): Promise<string> {
    const accounts = await this.accountRepository.findByCompanyId(companyId);
    return accounts[0]?.currency ?? "BRL";
  }

  private publish(budget: Budget): void {
    for (const event of budget.events) {
      this.eventBus.publish(event);
    }
    budget.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
