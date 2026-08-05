import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when a loan is contracted, together with the schedule generated from
 * the contract terms.
 */
export class LoanCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly description: string,
    readonly principalAmount: Money,
    readonly installmentCount: number,
    readonly installmentAmount: Money,
    readonly monthlyInterestPercent: number,
    readonly firstDueDate: Date,
    readonly personId?: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "LoanCreated";
  }
}

/**
 * Raised when the last outstanding amount of a loan is repaid. Settled is
 * final: nothing transitions out of it.
 */
export class LoanSettled extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly settledAt: Date,
    readonly principalAmount: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "LoanSettled";
  }
}

/**
 * Raised by the daily detection pass when an installment's due date has passed
 * without payment.
 */
export class LoanPaymentMissed extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly installmentId: string,
    readonly installmentNumber: number,
    readonly dueDate: Date,
    readonly daysLate: number,
    readonly amount: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "LoanPaymentMissed";
  }
}
