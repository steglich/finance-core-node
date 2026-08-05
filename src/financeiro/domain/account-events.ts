import { DomainEvent } from "../../shared/domain/domain-event.js";
import type { Money } from "./money.js";

/**
 * Raised when a new account is created.
 */
export class AccountCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly walletId: string,
    readonly name: string,
    readonly currency: string,
    readonly initialBalance: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "AccountCreated";
  }
}

/**
 * Raised when an account is created with a non-zero initial balance.
 * Carries the adjustment transaction that infrastructure must persist so the
 * balance stays derived from transactions (RN-02) and linked to the account (RN-03).
 */
export class AccountInitialBalanceRecorded extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly adjustmentTransactionId: string,
    readonly amount: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "AccountInitialBalanceRecorded";
  }
}

/**
 * Raised when a confirmed transaction increases the account balance.
 */
export class AccountCredited extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly transactionId: string,
    readonly amount: Money,
    readonly balanceAfter: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "AccountCredited";
  }
}

/**
 * Raised when a confirmed transaction decreases the account balance.
 */
export class AccountDebited extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly transactionId: string,
    readonly amount: Money,
    readonly balanceAfter: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "AccountDebited";
  }
}

/**
 * Raised when an account is deactivated.
 */
export class AccountDeactivated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "AccountDeactivated";
  }
}

/**
 * Raised when reconciliation finds the cached balance diverging from the
 * balance derived from confirmed transactions.
 */
export class AccountBalanceMismatchDetected extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly cachedBalance: Money,
    readonly derivedBalance: Money,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "AccountBalanceMismatchDetected";
  }
}
