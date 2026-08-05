import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";
import type { Period } from "./period.js";

/**
 * Raised when a budget is created for a period and at least one dimension.
 */
export class BudgetCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly categoryId: string | undefined,
    readonly costCenterId: string | undefined,
    readonly period: Period,
    readonly plannedAmount: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "BudgetCreated";
  }
}

/**
 * Raised the first time the actual amount passes the planned amount. Not
 * published again until the budget falls back below 100%.
 */
export class BudgetExceeded extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly categoryId: string | undefined,
    readonly period: Period,
    readonly plannedAmount: Money,
    readonly actualAmount: Money,
    readonly percentUsed: number,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "BudgetExceeded";
  }
}

/**
 * Raised when the budget period ends and the actual amount is frozen.
 */
export class BudgetPeriodClosed extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly categoryId: string | undefined,
    readonly period: Period,
    readonly plannedAmount: Money,
    readonly actualAmount: Money,
    /** Planned minus actual: negative when the budget was overspent. */
    readonly variance: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "BudgetPeriodClosed";
  }
}
