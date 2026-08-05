import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when a transfer is completed (both legs posted).
 */
export class TransferCompleted extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly sourceAccountId: string,
    readonly targetAccountId: string,
    readonly debitedAmount: Money,
    readonly creditedAmount: Money,
    readonly debitTransactionId: string,
    readonly creditTransactionId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "TransferCompleted";
  }
}

/**
 * Raised when a transfer is reversed; both legs are refunded together.
 */
export class TransferReversed extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly debitTransactionId: string,
    readonly creditTransactionId: string,
    readonly reason?: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "TransferReversed";
  }
}
