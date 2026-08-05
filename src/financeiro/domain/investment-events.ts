import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when an investment is registered. It starts with an empty position:
 * quantity and cost only exist once operations are registered.
 */
export class InvestmentCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly name: string,
    readonly investmentType: string,
    readonly currency: string,
    readonly symbol?: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InvestmentCreated";
  }
}

/**
 * Raised for every accepted operation, carrying what the position derivation
 * consumed: the type, the quantity and the amount that moved the account.
 */
export class InvestmentOperationRegistered extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly operationId: string,
    readonly operationType: string,
    readonly quantity: number,
    readonly amount: Money,
    readonly operatedAt: Date,
    readonly transactionId?: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InvestmentOperationRegistered";
  }
}

/**
 * Raised when an investment with a zero position is closed. Closing is not a
 * deletion: the investment and its operations stay visible in reports.
 */
export class InvestmentClosed extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly closedAt: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InvestmentClosed";
  }
}
