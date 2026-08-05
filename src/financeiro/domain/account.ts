import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { Money } from "./money.js";
import {
  AccountBalanceMismatchDetected,
  AccountCreated,
  AccountCredited,
  AccountDebited,
  AccountDeactivated,
  AccountInitialBalanceRecorded,
} from "./account-events.js";

/**
 * Account type enumeration.
 */
export type AccountType = "CHECKING" | "SAVINGS" | "INVESTMENT" | "CASH";

/**
 * A confirmed movement that affects the account balance.
 * Every entry must carry the transaction that originated it (RN-03).
 */
export interface AccountEntry {
  transactionId: string;
  accountId: string;
  direction: "CREDIT" | "DEBIT";
  amount: Money;
}

/**
 * Outcome of a balance reconciliation (RN-02).
 */
export interface ReconciliationResult {
  matched: boolean;
  cachedBalance: Money;
  derivedBalance: Money;
}

/**
 * Constructor properties for rehydrating an account from persistence.
 */
export interface AccountProps {
  id: string;
  companyId: string;
  walletId: string;
  name: string;
  number: string;
  type: AccountType;
  currency: string;
  balance?: Money;
  blockedAmount?: Money;
  isActive?: boolean;
  createdAt?: Date;
}

/**
 * Input for creating a new account.
 */
export interface CreateAccountInput {
  id?: string;
  companyId: string;
  walletId: string;
  name: string;
  number: string;
  type: AccountType;
  currency: string;
  initialBalance?: number | undefined;
}

const ACCOUNT_TYPES: ReadonlySet<string> = new Set<AccountType>([
  "CHECKING",
  "SAVINGS",
  "INVESTMENT",
  "CASH",
]);

/**
 * Account aggregate root.
 *
 * The balance is a cache derived from confirmed transactions (RN-02): it can only
 * change through credit()/debit(), each of which requires the originating
 * transaction (RN-03), and reconcile() recomputes it from the entries themselves.
 */
export class Account extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _walletId: string;
  private readonly _name: string;
  private readonly _number: string;
  private readonly _type: AccountType;
  private readonly _currency: string;
  private _balance: Money;
  private _blockedAmount: Money;
  private _isActive: boolean;

  constructor(props: AccountProps) {
    super(props.id, props.createdAt);

    const name = props.name.trim();
    const number = props.number.trim();
    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Account requires a company",
      );
    }

    if (name.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Account name is required");
    }

    if (props.walletId.trim().length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Account requires a wallet");
    }

    if (!ACCOUNT_TYPES.has(props.type)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid account type: ${props.type}`,
      );
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    const balance = props.balance ?? Money.zero(currency);
    const blockedAmount = props.blockedAmount ?? Money.zero(currency);

    if (balance.currency !== currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Balance currency ${balance.currency} does not match account currency ${currency}`,
      );
    }

    if (blockedAmount.currency !== currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Blocked amount currency ${blockedAmount.currency} does not match account currency ${currency}`,
      );
    }

    if (blockedAmount.isNegative()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Blocked amount cannot be negative",
      );
    }

    this._companyId = props.companyId;
    this._walletId = props.walletId;
    this._name = name;
    this._number = number;
    this._type = props.type;
    this._currency = currency;
    this._balance = balance;
    this._blockedAmount = blockedAmount;
    this._isActive = props.isActive ?? true;
  }

  get companyId(): string {
    return this._companyId;
  }

  get walletId(): string {
    return this._walletId;
  }

  get name(): string {
    return this._name;
  }

  get number(): string {
    return this._number;
  }

  get type(): AccountType {
    return this._type;
  }

  /**
   * Currency is immutable after creation.
   */
  get currency(): string {
    return this._currency;
  }

  /**
   * Cached balance derived from confirmed transactions. Not directly settable.
   */
  get balance(): Money {
    return this._balance;
  }

  get blockedAmount(): Money {
    return this._blockedAmount;
  }

  /**
   * Balance minus amounts blocked by pending operations.
   */
  get availableBalance(): Money {
    return this._balance.subtract(this._blockedAmount);
  }

  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * RN-03: every balance movement must come from a transaction bound to this account.
   */
  private validateEntry(entry: AccountEntry): DomainError | undefined {
    if (entry.transactionId.trim().length === 0) {
      return DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        "Balance movements require the originating transaction (RN-03)",
      );
    }

    if (entry.accountId !== this.id) {
      return DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Transaction ${entry.transactionId} belongs to account ${entry.accountId}, not ${this.id} (RN-03)`,
      );
    }

    if (entry.amount.currency !== this._currency) {
      return DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Transaction currency ${entry.amount.currency} does not match account currency ${this._currency}`,
      );
    }

    if (!entry.amount.isPositive()) {
      return DomainError.create(
        "VALIDATION_ERROR",
        "Movement amount must be positive; use the direction to signal credit or debit",
      );
    }

    return undefined;
  }

  /**
   * Increases the balance from a confirmed transaction.
   */
  credit(entry: AccountEntry): Result<Money> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Inactive accounts do not accept new transactions",
        ),
      );
    }

    const error = this.validateEntry(entry);
    if (error) {
      return Result.failed(error);
    }

    this._balance = this._balance.add(entry.amount);
    this.setUpdatedAt();
    this.raiseEvent(
      new AccountCredited(
        this.id,
        this._companyId,
        entry.transactionId,
        entry.amount,
        this._balance,
      ),
    );

    return Result.success(this._balance);
  }

  /**
   * Decreases the balance from a confirmed transaction.
   */
  debit(entry: AccountEntry): Result<Money> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Inactive accounts do not accept new transactions",
        ),
      );
    }

    const error = this.validateEntry(entry);
    if (error) {
      return Result.failed(error);
    }

    this._balance = this._balance.subtract(entry.amount);
    this.setUpdatedAt();
    this.raiseEvent(
      new AccountDebited(
        this.id,
        this._companyId,
        entry.transactionId,
        entry.amount,
        this._balance,
      ),
    );

    return Result.success(this._balance);
  }

  /**
   * RN-02: recomputes the balance from all confirmed entries and corrects the cache
   * when it diverges, raising an event so the divergence can be audited.
   */
  reconcile(entries: readonly AccountEntry[]): Result<ReconciliationResult> {
    let derived = Money.zero(this._currency);

    for (const entry of entries) {
      const error = this.validateEntry(entry);
      if (error) {
        return Result.failed(error);
      }
      derived =
        entry.direction === "CREDIT"
          ? derived.add(entry.amount)
          : derived.subtract(entry.amount);
    }

    const cachedBalance = this._balance;
    const matched = cachedBalance.equals(derived);

    if (!matched) {
      this._balance = derived;
      this.setUpdatedAt();
      this.raiseEvent(
        new AccountBalanceMismatchDetected(
          this.id,
          this._companyId,
          cachedBalance,
          derived,
        ),
      );
    }

    return Result.success({ matched, cachedBalance, derivedBalance: derived });
  }

  /**
   * Deactivates the account. Blocked while pending transactions remain, while an
   * active card is bound to it, or while any of those cards has an unpaid
   * invoice — the account still owes money in all three cases.
   */
  deactivate(
    pendingTransactionCount: number,
    activeCardCount = 0,
    unpaidInvoiceCount = 0,
  ): Result<Account> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Account is already inactive",
        ),
      );
    }

    if (pendingTransactionCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Account has ${pendingTransactionCount} pending transaction(s) and cannot be deactivated`,
        ),
      );
    }

    if (activeCardCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Account has ${activeCardCount} active card(s) and cannot be deactivated`,
        ),
      );
    }

    if (unpaidInvoiceCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Account has ${unpaidInvoiceCount} unpaid invoice(s) and cannot be deactivated`,
        ),
      );
    }

    this._isActive = false;
    this.setUpdatedAt();
    this.raiseEvent(new AccountDeactivated(this.id, this._companyId));

    return Result.success(this);
  }

  /**
   * Blocks part of the balance (e.g. pending debits), reducing the available balance.
   */
  block(amount: Money): Result<Money> {
    if (amount.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Blocked amount currency ${amount.currency} does not match account currency ${this._currency}`,
        ),
      );
    }

    if (amount.isNegative()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "Blocked amount cannot be negative",
        ),
      );
    }

    this._blockedAmount = amount;
    this.setUpdatedAt();

    return Result.success(this.availableBalance);
  }

  /**
   * Returns a copy with a new name; currency stays immutable.
   */
  rename(name: string): Account {
    return this.copyWith({ name });
  }

  /**
   * Returns a copy linked to another wallet; currency stays immutable.
   */
  changeWallet(walletId: string): Account {
    return this.copyWith({ walletId });
  }

  private copyWith(changes: Partial<Omit<AccountProps, "id">>): Account {
    return new Account({
      id: this.id,
      companyId: changes.companyId ?? this._companyId,
      walletId: changes.walletId ?? this._walletId,
      name: changes.name ?? this._name,
      number: changes.number ?? this._number,
      type: changes.type ?? this._type,
      currency: this._currency,
      balance: changes.balance ?? this._balance,
      blockedAmount: changes.blockedAmount ?? this._blockedAmount,
      isActive: changes.isActive ?? this._isActive,
      createdAt: this.createdAt,
    });
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this.companyId,
      walletId: this.walletId,
      name: this.name,
      number: this.number,
      type: this.type,
      currency: this.currency,
      balance: this.balance.amount,
      blockedAmount: this.blockedAmount.amount,
      availableBalance: this.availableBalance.amount,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates an account, validating the currency and, when an initial balance is
   * given, raising the adjustment transaction that records it (RN-02, RN-03).
   */
  static create(input: CreateAccountInput): Result<Account> {
    let account: Account;

    try {
      account = new Account({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        walletId: input.walletId,
        name: input.name,
        number: input.number,
        type: input.type,
        currency: input.currency,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    let initialBalance: Money;
    try {
      initialBalance = Money.create(
        input.initialBalance ?? 0,
        account.currency,
      );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    account.raiseEvent(
      new AccountCreated(
        account.id,
        account.companyId,
        account.walletId,
        account.name,
        account.currency,
        initialBalance,
      ),
    );

    if (!initialBalance.isZero()) {
      const adjustmentTransactionId = randomUUID();
      const entry: AccountEntry = {
        transactionId: adjustmentTransactionId,
        accountId: account.id,
        direction: initialBalance.isPositive() ? "CREDIT" : "DEBIT",
        amount: initialBalance.abs(),
      };

      const movement =
        entry.direction === "CREDIT"
          ? account.credit(entry)
          : account.debit(entry);

      if (movement.isFailure) {
        const movementError = movement.error;
        return movementError
          ? Result.failed(movementError)
          : Result.failed(
              DomainError.create(
                "BUSINESS_RULE_VIOLATION",
                "Could not record the initial balance adjustment",
              ),
            );
      }

      account.raiseEvent(
        new AccountInitialBalanceRecorded(
          account.id,
          account.companyId,
          adjustmentTransactionId,
          initialBalance,
        ),
      );
    }

    return Result.success(account);
  }
}
