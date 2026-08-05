import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when a goal is created.
 */
export class GoalCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly name: string,
    readonly targetAmount: Money,
    readonly deadline: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "GoalCreated";
  }
}

/**
 * Raised for every contribution registered against a goal.
 */
export class ContributionMade extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly contributionId: string,
    readonly amount: Money,
    readonly currentAmount: Money,
    readonly progressPercent: number,
    readonly contributedAt: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "ContributionMade";
  }
}

/**
 * Raised when the contributions reach the target amount.
 */
export class GoalAchieved extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly achievedAt: Date,
    readonly contributionCount: number,
    readonly finalAmount: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "GoalAchieved";
  }
}
