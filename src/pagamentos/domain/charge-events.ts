import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "../../financeiro/domain/money.js";

/**
 * Raised when a charge is issued to a customer.
 */
export class ChargeIssued extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly personId: string,
    readonly amount: Money,
    readonly dueDate: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "ChargeIssued";
  }
}

/**
 * Raised when a charge is settled, carrying the breakdown that was actually
 * charged on the receipt date.
 */
export class ChargePaid extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly personId: string,
    readonly amount: Money,
    readonly penalty: Money,
    readonly interest: Money,
    readonly receivedAt: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "ChargePaid";
  }
}

/**
 * Raised when the due date passes without settlement.
 */
export class ChargeOverdue extends DomainEvent<string> {
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
    return "ChargeOverdue";
  }
}

/**
 * Raised when a charge is cancelled. Cancelling creates no transaction and
 * reverses none — the reason is the whole record.
 */
export class ChargeCancelled extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly personId: string,
    readonly reason: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "ChargeCancelled";
  }
}

/**
 * Raised when an issued charge is edited (RN-09 audit trail).
 */
export class ChargeEdited extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly amount: Money,
    readonly dueDate: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "ChargeEdited";
  }
}
