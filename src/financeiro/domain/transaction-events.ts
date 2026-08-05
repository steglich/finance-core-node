import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when a transaction is registered (still pending).
 */
export class TransactionRegistered extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly type: string,
    readonly netAmount: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "TransactionRegistered";
  }
}

/**
 * Raised when a pending transaction is confirmed and hits the account balance.
 */
export class TransactionPosted extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly type: string,
    readonly netAmount: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "TransactionPosted";
  }
}

/**
 * Raised when a pending transaction is cancelled.
 */
export class TransactionCancelled extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly reason?: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "TransactionCancelled";
  }
}

/**
 * Raised when a confirmed transaction is refunded and its balance impact reverted.
 */
export class TransactionRefunded extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly netAmount: Money,
    readonly reason?: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "TransactionRefunded";
  }
}

/**
 * Raised for every field changed while editing a pending transaction, so the
 * audit trail can be rebuilt from the event stream.
 */
export class TransactionEdited extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly changes: readonly TransactionFieldChange[],
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "TransactionEdited";
  }
}

/**
 * A single audited field change.
 */
export interface TransactionFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}
