import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { toUtcDate } from "./date-math.js";
import { Money } from "./money.js";
import {
  RecurrenceCancelled,
  RecurrenceCompleted,
  RecurrenceCreated,
  RecurrenceOccurrenceGenerated,
  RecurrencePaused,
  RecurrenceResumed,
} from "./recurrence-events.js";
import type { TransactionType } from "./transaction.js";

/**
 * Supported recurrence periodicities.
 */
export type Periodicity =
  | "DAILY"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMIANNUAL"
  | "ANNUAL";

/**
 * Recurrence lifecycle states.
 */
export type RecurrenceStatus =
  | "ACTIVE"
  | "PAUSED"
  | "CANCELLED"
  | "COMPLETED";

const PERIODICITIES: ReadonlySet<string> = new Set<Periodicity>([
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
]);

/**
 * Constructor properties for rehydrating a recurrence from persistence.
 */
export interface RecurrenceProps {
  id: string;
  companyId: string;
  accountId: string;
  categoryId?: string | undefined;
  description: string;
  amount: Money;
  type?: TransactionType;
  periodicity: Periodicity;
  startDate: Date;
  endDate?: Date | undefined;
  maxOccurrences?: number | undefined;
  status?: RecurrenceStatus;
  generatedCount?: number;
  createdAt?: Date;
}

/**
 * Input for creating a new recurrence.
 */
export interface CreateRecurrenceInput {
  id?: string;
  companyId: string;
  accountId: string;
  categoryId?: string | undefined;
  description: string;
  amount: number;
  currency: string;
  type?: TransactionType;
  periodicity: Periodicity;
  startDate: Date;
  endDate?: Date | undefined;
  maxOccurrences?: number | undefined;
}

/**
 * Editable recurrence fields.
 */
export interface EditRecurrenceInput {
  description?: string | undefined;
  amount?: number | undefined;
  categoryId?: string | undefined;
  endDate?: Date | undefined;
  maxOccurrences?: number | undefined;
}

/**
 * Recurrence aggregate root.
 *
 * Holds the configuration and the lifecycle; the schedule itself is computed by
 * `RecurrenceService`, which is stateless and derives every occurrence from the
 * start date so month-end anchors never drift.
 */
export class Recurrence extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _accountId: string;
  private readonly _periodicity: Periodicity;
  private readonly _startDate: Date;
  private readonly _type: TransactionType;
  private _categoryId: string | undefined;
  private _description: string;
  private _amount: Money;
  private _endDate: Date | undefined;
  private _maxOccurrences: number | undefined;
  private _status: RecurrenceStatus;
  private _generatedCount: number;

  constructor(props: RecurrenceProps) {
    super(props.id, props.createdAt);

    const description = props.description.trim();

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Recurrence requires a company",
      );
    }

    if (props.accountId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Recurrence requires an account (RN-03)",
      );
    }

    if (description.length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Recurrence description is required",
      );
    }

    if (!PERIODICITIES.has(props.periodicity)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid periodicity: ${props.periodicity}`,
      );
    }

    if (!props.amount.isPositive()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Recurrence amount must be greater than zero",
      );
    }

    if (Number.isNaN(props.startDate.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid start date");
    }

    const startDate = toUtcDate(props.startDate);
    const endDate = props.endDate ? toUtcDate(props.endDate) : undefined;

    if (endDate) {
      if (Number.isNaN(endDate.getTime())) {
        throw DomainError.create("VALIDATION_ERROR", "Invalid end date");
      }
      if (endDate.getTime() < startDate.getTime()) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "Recurrence end date cannot be earlier than the start date",
        );
      }
    }

    if (props.maxOccurrences !== undefined) {
      if (
        !Number.isInteger(props.maxOccurrences) ||
        props.maxOccurrences < 1
      ) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "Maximum occurrences must be a positive integer",
        );
      }
    }

    this._companyId = props.companyId;
    this._accountId = props.accountId;
    this._categoryId = props.categoryId;
    this._description = description;
    this._amount = props.amount;
    this._type = props.type ?? "EXPENSE";
    this._periodicity = props.periodicity;
    this._startDate = startDate;
    this._endDate = endDate;
    this._maxOccurrences = props.maxOccurrences;
    this._status = props.status ?? "ACTIVE";
    this._generatedCount = props.generatedCount ?? 0;
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

  get description(): string {
    return this._description;
  }

  get amount(): Money {
    return this._amount;
  }

  get type(): TransactionType {
    return this._type;
  }

  get periodicity(): Periodicity {
    return this._periodicity;
  }

  get startDate(): Date {
    return new Date(this._startDate.getTime());
  }

  get endDate(): Date | undefined {
    return this._endDate ? new Date(this._endDate.getTime()) : undefined;
  }

  get maxOccurrences(): number | undefined {
    return this._maxOccurrences;
  }

  get status(): RecurrenceStatus {
    return this._status;
  }

  get generatedCount(): number {
    return this._generatedCount;
  }

  get isActive(): boolean {
    return this._status === "ACTIVE";
  }

  /**
   * Suspends generation. The schedule itself is untouched: resuming continues
   * from the next scheduled date, it does not backfill the paused period.
   */
  pause(): Result<Recurrence> {
    if (this._status !== "ACTIVE") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Only active recurrences can be paused; this one is ${this._status}`,
        ),
      );
    }

    this._status = "PAUSED";
    this.setUpdatedAt();
    this.raiseEvent(new RecurrencePaused(this.id, this._companyId));

    return Result.success(this);
  }

  /**
   * Reactivates a paused recurrence.
   */
  resume(): Result<Recurrence> {
    if (this._status !== "PAUSED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Only paused recurrences can be resumed; this one is ${this._status}`,
        ),
      );
    }

    this._status = "ACTIVE";
    this.setUpdatedAt();
    this.raiseEvent(new RecurrenceResumed(this.id, this._companyId));

    return Result.success(this);
  }

  /**
   * Stops future generation for good. Transactions already generated are kept.
   */
  cancel(): Result<Recurrence> {
    if (this._status === "CANCELLED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Recurrence is already cancelled",
        ),
      );
    }

    this._status = "CANCELLED";
    this.setUpdatedAt();
    this.raiseEvent(
      new RecurrenceCancelled(this.id, this._companyId, this._generatedCount),
    );

    return Result.success(this);
  }

  /**
   * Edits the mutable configuration of a recurrence that is still running.
   */
  edit(input: EditRecurrenceInput): Result<Recurrence> {
    if (this._status === "CANCELLED" || this._status === "COMPLETED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A ${this._status.toLowerCase()} recurrence cannot be edited`,
        ),
      );
    }

    try {
      if (input.description !== undefined) {
        const description = input.description.trim();
        if (description.length === 0) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Recurrence description is required",
          );
        }
        this._description = description;
      }

      if (input.amount !== undefined) {
        const amount = Money.create(input.amount, this._amount.currency);
        if (!amount.isPositive()) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Recurrence amount must be greater than zero",
          );
        }
        this._amount = amount;
      }

      if (input.categoryId !== undefined) {
        this._categoryId = input.categoryId;
      }

      if (input.endDate !== undefined) {
        const endDate = toUtcDate(input.endDate);
        if (Number.isNaN(endDate.getTime())) {
          throw DomainError.create("VALIDATION_ERROR", "Invalid end date");
        }
        if (endDate.getTime() < this._startDate.getTime()) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Recurrence end date cannot be earlier than the start date",
          );
        }
        this._endDate = endDate;
      }

      if (input.maxOccurrences !== undefined) {
        if (
          !Number.isInteger(input.maxOccurrences) ||
          input.maxOccurrences < 1
        ) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Maximum occurrences must be a positive integer",
          );
        }
        this._maxOccurrences = input.maxOccurrences;
      }
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    this.setUpdatedAt();
    return Result.success(this);
  }

  /**
   * Records that an occurrence was generated, completing the recurrence when the
   * maximum number of occurrences is reached.
   */
  registerOccurrence(
    occurrenceDate: Date,
    transactionId: string,
  ): Result<Recurrence> {
    if (this._status !== "ACTIVE") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A ${this._status.toLowerCase()} recurrence does not generate transactions`,
        ),
      );
    }

    this._generatedCount += 1;
    this.setUpdatedAt();
    this.raiseEvent(
      new RecurrenceOccurrenceGenerated(
        this.id,
        this._companyId,
        this._generatedCount,
        toUtcDate(occurrenceDate),
        transactionId,
      ),
    );

    if (
      this._maxOccurrences !== undefined &&
      this._generatedCount >= this._maxOccurrences
    ) {
      this._status = "COMPLETED";
      this.raiseEvent(
        new RecurrenceCompleted(
          this.id,
          this._companyId,
          this._generatedCount,
        ),
      );
    }

    return Result.success(this);
  }

  /**
   * Marks the recurrence as finished because its end date has passed.
   */
  complete(): Result<Recurrence> {
    if (this._status === "COMPLETED") {
      return Result.success(this);
    }

    if (this._status === "CANCELLED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A cancelled recurrence cannot be completed",
        ),
      );
    }

    this._status = "COMPLETED";
    this.setUpdatedAt();
    this.raiseEvent(
      new RecurrenceCompleted(this.id, this._companyId, this._generatedCount),
    );

    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      accountId: this._accountId,
      categoryId: this._categoryId,
      description: this._description,
      amount: this._amount.amount,
      currency: this._amount.currency,
      type: this._type,
      periodicity: this._periodicity,
      startDate: this._startDate,
      endDate: this._endDate,
      maxOccurrences: this._maxOccurrences,
      status: this._status,
      generatedCount: this._generatedCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static create(input: CreateRecurrenceInput): Result<Recurrence> {
    try {
      const currency = normalizeCurrency(input.currency);
      if (!isSupportedCurrency(currency)) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          `Unsupported currency: ${input.currency}`,
        );
      }

      const recurrence = new Recurrence({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        accountId: input.accountId,
        categoryId: input.categoryId,
        description: input.description,
        amount: Money.create(input.amount, currency),
        type: input.type ?? "EXPENSE",
        periodicity: input.periodicity,
        startDate: input.startDate,
        endDate: input.endDate,
        maxOccurrences: input.maxOccurrences,
      });

      recurrence.raiseEvent(
        new RecurrenceCreated(
          recurrence.id,
          recurrence.companyId,
          recurrence.accountId,
          recurrence.periodicity,
          recurrence.startDate,
        ),
      );

      return Result.success(recurrence);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
