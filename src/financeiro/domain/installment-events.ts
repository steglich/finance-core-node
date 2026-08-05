import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when an installment is settled.
 */
export class InstallmentPaid extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly parentTransactionId: string,
    readonly number: number,
    readonly amount: Money,
    readonly paymentDate: Date,
    readonly accountId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InstallmentPaid";
  }
}

/**
 * Raised when an installment passes its due date unpaid.
 */
export class InstallmentOverdue extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly parentTransactionId: string,
    readonly number: number,
    readonly dueDate: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InstallmentOverdue";
  }
}

/**
 * Raised when the due date of a pending installment is changed (audit trail).
 */
export class InstallmentDueDateChanged extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly oldDueDate: Date,
    readonly newDueDate: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "InstallmentDueDateChanged";
  }
}
