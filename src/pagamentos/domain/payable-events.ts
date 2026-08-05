import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "../../financeiro/domain/money.js";

/**
 * Raised when an obligation towards a supplier is recorded.
 */
export class PayableRegistered extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly personId: string,
    readonly categoryId: string,
    readonly amount: Money,
    readonly dueDate: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PayableRegistered";
  }
}

/**
 * Raised when a payable is settled.
 */
export class PayablePaid extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly personId: string,
    readonly amount: Money,
    readonly paidAt: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PayablePaid";
  }
}

/**
 * Raised when the due date passes without settlement.
 */
export class PayableOverdue extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly personId: string,
    readonly dueDate: Date,
    readonly daysLate: number,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PayableOverdue";
  }
}

/**
 * Raised when a payable is cancelled. Like a charge, cancelling creates no
 * transaction and reverses none.
 */
export class PayableCancelled extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly personId: string,
    readonly reason: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PayableCancelled";
  }
}

/**
 * Raised when a pending payable is edited (RN-09 audit trail).
 */
export class PayableEdited extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly amount: Money,
    readonly dueDate: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PayableEdited";
  }
}
