import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when a cycle closes and the invoice becomes a payment obligation
 * distinct from the individual purchases that make it up (RN-08).
 */
export class InvoiceClosed extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly cardId: string,
    readonly accountId: string,
    readonly totalAmount: Money,
    readonly currency: string,
    readonly dueDate: Date,
    readonly closingDate: Date,
    readonly transactionIds: readonly string[],
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InvoiceClosed";
  }
}

/**
 * Raised when the outstanding balance of an invoice reaches zero.
 */
export class InvoicePaid extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly cardId: string,
    readonly totalAmount: Money,
    readonly paidAmount: Money,
    readonly paidAt: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InvoicePaid";
  }
}

/**
 * Raised when a closed or partially paid invoice passes its due date with an
 * outstanding balance.
 */
export class InvoiceOverdue extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly cardId: string,
    readonly dueDate: Date,
    readonly outstanding: Money,
    readonly overdueDays: number,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InvoiceOverdue";
  }
}
