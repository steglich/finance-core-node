import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when a card is created and bound to an account.
 */
export class CardCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly name: string,
    readonly type: string,
    readonly brand: string,
    readonly limit: Money | undefined,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "CardCreated";
  }
}

/**
 * Raised when the credit limit changes, so the audit trail keeps the old value.
 */
export class CardLimitChanged extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly oldLimit: Money | undefined,
    readonly newLimit: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "CardLimitChanged";
  }
}

/**
 * Raised when a card is deactivated. Cards are never physically deleted.
 */
export class CardDeactivated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "CardDeactivated";
  }
}
