import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import type { ExchangeRate } from "./exchange-rate.js";
import { Money } from "./money.js";
import {
  TransactionCancelled,
  TransactionEdited,
  TransactionPosted,
  TransactionRefunded,
  TransactionRegistered,
} from "./transaction-events.js";
import type { TransactionFieldChange } from "./transaction-events.js";

/**
 * Transaction type enumeration.
 */
export type TransactionType =
  | "EXPENSE"
  | "INCOME"
  | "TRANSFER"
  | "ADJUSTMENT";

/**
 * Transaction lifecycle states.
 */
export type TransactionStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "REFUNDED";

/**
 * Allowed state transitions. Anything not listed here is rejected.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<TransactionStatus, readonly TransactionStatus[]>
> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

const TRANSACTION_TYPES: ReadonlySet<string> = new Set<TransactionType>([
  "EXPENSE",
  "INCOME",
  "TRANSFER",
  "ADJUSTMENT",
]);

const TRANSACTION_STATUSES: ReadonlySet<string> = new Set<TransactionStatus>([
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "REFUNDED",
]);

/**
 * Constructor properties for rehydrating a transaction from persistence.
 */
export interface TransactionProps {
  id: string;
  companyId: string;
  accountId: string;
  categoryId?: string | undefined;
  type: TransactionType;
  status?: TransactionStatus;
  grossAmount: Money;
  discount?: Money | undefined;
  interest?: Money | undefined;
  penalty?: Money | undefined;
  currency: string;
  exchangeRate?: ExchangeRate | undefined;
  date: Date;
  competence?: Date | undefined;
  description?: string | undefined;
  tags?: readonly string[] | undefined;
  parentTransactionId?: string | undefined;
  transferId?: string | undefined;
  createdAt?: Date;
}

/**
 * Input for registering a new transaction.
 */
export interface CreateTransactionInput {
  id?: string;
  companyId: string;
  accountId: string;
  categoryId?: string | undefined;
  type: TransactionType;
  grossAmount: number;
  discount?: number | undefined;
  interest?: number | undefined;
  penalty?: number | undefined;
  currency: string;
  accountCurrency?: string | undefined;
  exchangeRate?: ExchangeRate | undefined;
  date: Date;
  competence?: Date | undefined;
  description?: string | undefined;
  tags?: readonly string[] | undefined;
  parentTransactionId?: string | undefined;
  transferId?: string | undefined;
}

/**
 * Fields that may be changed while the transaction is still pending.
 */
export interface EditTransactionInput {
  grossAmount?: number | undefined;
  discount?: number | undefined;
  interest?: number | undefined;
  penalty?: number | undefined;
  categoryId?: string | undefined;
  date?: Date | undefined;
  competence?: Date | undefined;
  description?: string | undefined;
  tags?: readonly string[] | undefined;
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) {
    return [];
  }
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim();
    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }
  return [...seen];
}

function sameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

/**
 * Transaction aggregate root.
 *
 * Owns the state machine (Pending → Confirmed → Refunded / Pending → Cancelled),
 * the net amount calculation and the editability rules. It never touches the
 * account balance directly: confirming/refunding raises events that the
 * application layer applies to the `Account` aggregate (RN-02, RN-03).
 */
export class Transaction extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _accountId: string;
  private readonly _type: TransactionType;
  private readonly _currency: string;
  private readonly _exchangeRate: ExchangeRate | undefined;
  private readonly _parentTransactionId: string | undefined;
  private readonly _transferId: string | undefined;
  private _categoryId: string | undefined;
  private _status: TransactionStatus;
  private _grossAmount: Money;
  private _discount: Money;
  private _interest: Money;
  private _penalty: Money;
  private _date: Date;
  private _competence: Date;
  private _description: string | undefined;
  private _tags: string[];

  constructor(props: TransactionProps) {
    super(props.id, props.createdAt);

    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Transaction requires a company",
      );
    }

    // RN-03: a transaction only exists bound to an account.
    if (props.accountId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Transaction requires an account (RN-03)",
      );
    }

    if (!TRANSACTION_TYPES.has(props.type)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid transaction type: ${props.type}`,
      );
    }

    const status = props.status ?? "PENDING";
    if (!TRANSACTION_STATUSES.has(status)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid transaction status: ${status}`,
      );
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    if (Number.isNaN(props.date.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid transaction date");
    }

    const competence = props.competence ?? props.date;
    if (Number.isNaN(competence.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid competence date");
    }

    this._companyId = props.companyId;
    this._accountId = props.accountId;
    this._categoryId = props.categoryId;
    this._type = props.type;
    this._status = status;
    this._currency = currency;
    this._exchangeRate = props.exchangeRate;
    this._grossAmount = props.grossAmount;
    this._discount = props.discount ?? Money.zero(currency);
    this._interest = props.interest ?? Money.zero(currency);
    this._penalty = props.penalty ?? Money.zero(currency);
    this._date = new Date(props.date.getTime());
    this._competence = new Date(competence.getTime());
    this._description = props.description?.trim() || undefined;
    this._tags = normalizeTags(props.tags);
    this._parentTransactionId = props.parentTransactionId;
    this._transferId = props.transferId;

    this.assertAmountsAreValid();
  }

  private assertAmountsAreValid(): void {
    const components: readonly [string, Money][] = [
      ["gross amount", this._grossAmount],
      ["discount", this._discount],
      ["interest", this._interest],
      ["penalty", this._penalty],
    ];

    for (const [label, value] of components) {
      if (value.currency !== this._currency) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Transaction ${label} currency ${value.currency} does not match ${this._currency}`,
        );
      }
      if (value.isNegative()) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          `Transaction ${label} cannot be negative`,
        );
      }
    }

    if (!this._grossAmount.isPositive()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Transaction gross amount must be greater than zero",
      );
    }

    if (this._discount.greaterThan(this._grossAmount)) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        "Discount cannot exceed the gross amount",
      );
    }
  }

  get companyId(): string {
    return this._companyId;
  }

  get accountId(): string {
    return this._accountId;
  }

  get categoryId(): string | undefined {
    return this._categoryId;
  }

  get type(): TransactionType {
    return this._type;
  }

  get status(): TransactionStatus {
    return this._status;
  }

  get grossAmount(): Money {
    return this._grossAmount;
  }

  get discount(): Money {
    return this._discount;
  }

  get interest(): Money {
    return this._interest;
  }

  get penalty(): Money {
    return this._penalty;
  }

  /**
   * netAmount = grossAmount - discount + interest + penalty.
   */
  get netAmount(): Money {
    return this._grossAmount
      .subtract(this._discount)
      .add(this._interest)
      .add(this._penalty);
  }

  get currency(): string {
    return this._currency;
  }

  get exchangeRate(): ExchangeRate | undefined {
    return this._exchangeRate;
  }

  get date(): Date {
    return new Date(this._date.getTime());
  }

  get competence(): Date {
    return new Date(this._competence.getTime());
  }

  get description(): string | undefined {
    return this._description;
  }

  get tags(): readonly string[] {
    return [...this._tags];
  }

  get parentTransactionId(): string | undefined {
    return this._parentTransactionId;
  }

  get transferId(): string | undefined {
    return this._transferId;
  }

  get isPending(): boolean {
    return this._status === "PENDING";
  }

  /**
   * Direction this transaction applies to the account balance once confirmed.
   */
  get direction(): "CREDIT" | "DEBIT" {
    return this._type === "INCOME" ? "CREDIT" : "DEBIT";
  }

  /**
   * State machine guard: rejects any transition not declared in ALLOWED_TRANSITIONS.
   */
  private ensureCanTransitionTo(next: TransactionStatus): DomainError | undefined {
    if (ALLOWED_TRANSITIONS[this._status].includes(next)) {
      return undefined;
    }

    if (this._status === "CONFIRMED" && next === "CANCELLED") {
      return DomainError.create(
        "INVALID_OPERATION",
        "A confirmed transaction cannot be cancelled; refund it instead",
      );
    }

    return DomainError.create(
      "INVALID_OPERATION",
      `Cannot transition transaction from ${this._status} to ${next}`,
    );
  }

  /**
   * Pending → Confirmed. The caller applies the balance movement to the account.
   */
  confirm(): Result<Transaction> {
    const error = this.ensureCanTransitionTo("CONFIRMED");
    if (error) {
      return Result.failed(error);
    }

    this._status = "CONFIRMED";
    this.setUpdatedAt();
    this.raiseEvent(
      new TransactionPosted(
        this.id,
        this._companyId,
        this._accountId,
        this._type,
        this.netAmount,
      ),
    );

    return Result.success(this);
  }

  /**
   * Pending → Cancelled. The record is preserved; nothing is deleted.
   */
  cancel(reason?: string): Result<Transaction> {
    const error = this.ensureCanTransitionTo("CANCELLED");
    if (error) {
      return Result.failed(error);
    }

    this._status = "CANCELLED";
    this.setUpdatedAt();
    this.raiseEvent(
      new TransactionCancelled(
        this.id,
        this._companyId,
        this._accountId,
        reason,
      ),
    );

    return Result.success(this);
  }

  /**
   * Confirmed → Refunded. The caller reverts the balance movement.
   */
  refund(reason?: string): Result<Transaction> {
    const error = this.ensureCanTransitionTo("REFUNDED");
    if (error) {
      return Result.failed(error);
    }

    this._status = "REFUNDED";
    this.setUpdatedAt();
    this.raiseEvent(
      new TransactionRefunded(
        this.id,
        this._companyId,
        this._accountId,
        this.netAmount,
        reason,
      ),
    );

    return Result.success(this);
  }

  private applyMonetaryField(
    field: "grossAmount" | "discount" | "interest" | "penalty",
    value: Money,
  ): void {
    switch (field) {
      case "grossAmount":
        this._grossAmount = value;
        break;
      case "discount":
        this._discount = value;
        break;
      case "interest":
        this._interest = value;
        break;
      case "penalty":
        this._penalty = value;
        break;
    }
  }

  /**
   * Edits the allowed fields of a pending transaction, raising a
   * TransactionEdited event carrying the field-level diff for auditing.
   */
  edit(input: EditTransactionInput): Result<readonly TransactionFieldChange[]> {
    if (this._status !== "PENDING") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Only pending transactions can be edited; this one is ${this._status}`,
        ),
      );
    }

    const snapshot = {
      grossAmount: this._grossAmount,
      discount: this._discount,
      interest: this._interest,
      penalty: this._penalty,
    };

    const changes: TransactionFieldChange[] = [];

    try {
      const monetaryFields: readonly (readonly [
        "grossAmount" | "discount" | "interest" | "penalty",
        number | undefined,
      ])[] = [
        ["grossAmount", input.grossAmount],
        ["discount", input.discount],
        ["interest", input.interest],
        ["penalty", input.penalty],
      ];

      for (const [field, value] of monetaryFields) {
        if (value === undefined) {
          continue;
        }
        const next = Money.create(value, this._currency);
        const current = snapshot[field];
        if (!current.equals(next)) {
          changes.push({
            field,
            oldValue: current.amount,
            newValue: next.amount,
          });
          this.applyMonetaryField(field, next);
        }
      }

      if (
        input.categoryId !== undefined &&
        input.categoryId !== this._categoryId
      ) {
        changes.push({
          field: "categoryId",
          oldValue: this._categoryId,
          newValue: input.categoryId,
        });
        this._categoryId = input.categoryId;
      }

      if (input.date !== undefined) {
        if (Number.isNaN(input.date.getTime())) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Invalid transaction date",
          );
        }
        if (!sameDay(input.date, this._date)) {
          changes.push({
            field: "date",
            oldValue: this._date,
            newValue: input.date,
          });
          this._date = new Date(input.date.getTime());
        }
      }

      if (input.competence !== undefined) {
        if (Number.isNaN(input.competence.getTime())) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Invalid competence date",
          );
        }
        if (!sameDay(input.competence, this._competence)) {
          changes.push({
            field: "competence",
            oldValue: this._competence,
            newValue: input.competence,
          });
          this._competence = new Date(input.competence.getTime());
        }
      }

      if (input.description !== undefined) {
        const description = input.description.trim() || undefined;
        if (description !== this._description) {
          changes.push({
            field: "description",
            oldValue: this._description,
            newValue: description,
          });
          this._description = description;
        }
      }

      if (input.tags !== undefined) {
        const tags = normalizeTags(input.tags);
        if (tags.join(" ") !== this._tags.join(" ")) {
          changes.push({
            field: "tags",
            oldValue: [...this._tags],
            newValue: tags,
          });
          this._tags = tags;
        }
      }

      this.assertAmountsAreValid();
    } catch (error) {
      // Restore the monetary snapshot so a rejected edit leaves no partial state.
      this._grossAmount = snapshot.grossAmount;
      this._discount = snapshot.discount;
      this._interest = snapshot.interest;
      this._penalty = snapshot.penalty;

      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    if (changes.length > 0) {
      this.setUpdatedAt();
      this.raiseEvent(
        new TransactionEdited(this.id, this._companyId, changes),
      );
    }

    return Result.success(changes);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      accountId: this._accountId,
      categoryId: this._categoryId,
      type: this._type,
      status: this._status,
      grossAmount: this._grossAmount.amount,
      discount: this._discount.amount,
      interest: this._interest.amount,
      penalty: this._penalty.amount,
      netAmount: this.netAmount.amount,
      currency: this._currency,
      exchangeRate: this._exchangeRate?.toJSON(),
      date: this._date,
      competence: this._competence,
      description: this._description,
      tags: this.tags,
      parentTransactionId: this._parentTransactionId,
      transferId: this._transferId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Registers a new pending transaction.
   *
   * RN-07: when the transaction currency differs from the account currency, an
   * exchange rate covering both currencies must be supplied.
   */
  static create(input: CreateTransactionInput): Result<Transaction> {
    try {
      const currency = normalizeCurrency(input.currency);
      const accountCurrency = input.accountCurrency
        ? normalizeCurrency(input.accountCurrency)
        : currency;

      if (accountCurrency !== currency) {
        const rate = input.exchangeRate;
        if (!rate) {
          throw DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            `Multi-currency transactions require a registered exchange rate (RN-07)`,
          );
        }
        const covers =
          (rate.sourceCurrency === currency &&
            rate.targetCurrency === accountCurrency) ||
          (rate.sourceCurrency === accountCurrency &&
            rate.targetCurrency === currency);
        if (!covers) {
          throw DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            `Exchange rate ${rate.sourceCurrency}/${rate.targetCurrency} does not cover ${currency}/${accountCurrency} (RN-07)`,
          );
        }
      }

      const transaction = new Transaction({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        accountId: input.accountId,
        categoryId: input.categoryId,
        type: input.type,
        status: "PENDING",
        grossAmount: Money.create(input.grossAmount, currency),
        discount:
          input.discount === undefined
            ? undefined
            : Money.create(input.discount, currency),
        interest:
          input.interest === undefined
            ? undefined
            : Money.create(input.interest, currency),
        penalty:
          input.penalty === undefined
            ? undefined
            : Money.create(input.penalty, currency),
        currency,
        exchangeRate: input.exchangeRate,
        date: input.date,
        competence: input.competence,
        description: input.description,
        tags: input.tags,
        parentTransactionId: input.parentTransactionId,
        transferId: input.transferId,
      });

      transaction.raiseEvent(
        new TransactionRegistered(
          transaction.id,
          transaction.companyId,
          transaction.accountId,
          transaction.type,
          transaction.netAmount,
        ),
      );

      return Result.success(transaction);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
