import { randomUUID } from "node:crypto";
import {
  isSupportedCurrency,
  normalizeCurrency,
} from "../../financeiro/domain/currency.js";
import { Money } from "../../financeiro/domain/money.js";
import { Percent } from "../../financeiro/domain/percent.js";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import {
  ChargeCancelled,
  ChargeEdited,
  ChargeIssued,
  ChargeOverdue,
  ChargePaid,
} from "./charge-events.js";
import { amountsDueFor, daysLate } from "./charge-math.js";
import type { AmountsDue } from "./charge-math.js";

/**
 * Charge lifecycle. PAID and CANCELLED are final.
 */
export type ChargeStatus = "ISSUED" | "OVERDUE" | "PAID" | "CANCELLED";

/**
 * The states from which a charge can still be settled or cancelled.
 */
const OPEN_STATUSES: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>([
  "ISSUED",
  "OVERDUE",
]);

/**
 * The subset of a person a charge needs to validate its customer.
 * `Person` satisfies it structurally — no import from `cadastros`.
 */
export interface ChargeCustomer {
  id: string;
  companyId: string;
  isActive: boolean;
  hasRole(role: "CUSTOMER" | "SUPPLIER" | "PAYEE"): boolean;
}

/**
 * Constructor properties for rehydrating a charge from persistence.
 */
export interface ChargeProps {
  id: string;
  companyId: string;
  personId: string;
  amount: Money;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  description?: string | undefined;
  penaltyPercent?: Percent | undefined;
  monthlyInterestPercent?: Percent | undefined;
  status?: ChargeStatus;
  externalReference?: string | undefined;
  cancelReason?: string | undefined;
  cancelledAt?: Date | undefined;
  paidAt?: Date | undefined;
  createdAt?: Date;
}

/**
 * Input for issuing a new charge.
 */
export interface IssueChargeInput {
  id?: string;
  companyId: string;
  customer: ChargeCustomer;
  amount: number;
  currency: string;
  dueDate: Date;
  issueDate?: Date | undefined;
  description?: string | undefined;
  penaltyPercent?: number | undefined;
  monthlyInterestPercent?: number | undefined;
}

/**
 * Mutable fields of a charge, editable only while it is ISSUED.
 */
export interface EditChargeInput {
  amount?: number | undefined;
  dueDate?: Date | undefined;
  description?: string | null | undefined;
  penaltyPercent?: number | undefined;
  monthlyInterestPercent?: number | undefined;
}

/**
 * Normalizes a date to UTC midnight, so comparing due dates never depends on
 * the time of day the record happened to be written at.
 */
function atMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Accounts receivable aggregate: an obligation of a customer towards the
 * company.
 *
 * Penalty and interest are never stored while the charge is open — they are a
 * function of the reference date, and `amountsDueAt()` derives them on demand.
 * Only the receipt freezes what was actually charged.
 */
export class Charge extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _personId: string;
  private readonly _currency: string;
  private _amount: Money;
  private _issueDate: Date;
  private _dueDate: Date;
  private _description: string | undefined;
  private _penaltyPercent: Percent;
  private _monthlyInterestPercent: Percent;
  private _status: ChargeStatus;
  private _externalReference: string | undefined;
  private _cancelReason: string | undefined;
  private _cancelledAt: Date | undefined;
  private _paidAt: Date | undefined;

  constructor(props: ChargeProps) {
    super(props.id, props.createdAt);

    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Charge requires a company",
      );
    }

    if (props.personId.trim().length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Charge requires a customer");
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    if (!props.amount.isPositive()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Charge amount must be greater than zero",
      );
    }

    if (props.amount.currency !== currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Charge amount currency ${props.amount.currency} does not match ${currency}`,
      );
    }

    const issueDate = atMidnight(props.issueDate);
    const dueDate = atMidnight(props.dueDate);

    if (dueDate.getTime() < issueDate.getTime()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Charge due date cannot be earlier than its issue date",
      );
    }

    this._companyId = props.companyId;
    this._personId = props.personId;
    this._currency = currency;
    this._amount = props.amount;
    this._issueDate = issueDate;
    this._dueDate = dueDate;
    this._description = props.description?.trim() || undefined;
    this._penaltyPercent = props.penaltyPercent ?? Percent.zero();
    this._monthlyInterestPercent =
      props.monthlyInterestPercent ?? Percent.zero();
    this._status = props.status ?? "ISSUED";
    this._externalReference = props.externalReference?.trim() || undefined;
    this._cancelReason = props.cancelReason?.trim() || undefined;
    this._cancelledAt = props.cancelledAt;
    this._paidAt = props.paidAt;
  }

  get companyId(): string {
    return this._companyId;
  }

  get personId(): string {
    return this._personId;
  }

  get amount(): Money {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  get issueDate(): Date {
    return this._issueDate;
  }

  get dueDate(): Date {
    return this._dueDate;
  }

  get description(): string | undefined {
    return this._description;
  }

  get penaltyPercent(): Percent {
    return this._penaltyPercent;
  }

  get monthlyInterestPercent(): Percent {
    return this._monthlyInterestPercent;
  }

  get status(): ChargeStatus {
    return this._status;
  }

  /**
   * Reserved for the bank slip identifier; unused until an integration exists.
   */
  get externalReference(): string | undefined {
    return this._externalReference;
  }

  get cancelReason(): string | undefined {
    return this._cancelReason;
  }

  get cancelledAt(): Date | undefined {
    return this._cancelledAt;
  }

  get paidAt(): Date | undefined {
    return this._paidAt;
  }

  /**
   * Whether the charge still awaits settlement.
   */
  get isOpen(): boolean {
    return OPEN_STATUSES.has(this._status);
  }

  /**
   * Days past the due date at `referenceDate`, zero while not late.
   */
  daysLateAt(referenceDate: Date): number {
    return daysLate(this._dueDate, referenceDate);
  }

  /**
   * Original amount, penalty, interest and total due at a given date.
   * A settled or cancelled charge accrues nothing further.
   */
  amountsDueAt(referenceDate: Date): AmountsDue {
    const days = this.isOpen ? this.daysLateAt(referenceDate) : 0;

    return amountsDueFor(
      this._amount,
      this._penaltyPercent,
      this._monthlyInterestPercent,
      days,
    );
  }

  /**
   * Marks the charge overdue. Idempotent by the state machine: a charge already
   * OVERDUE fails, which is what makes the daily detection safe to re-run.
   */
  markOverdue(referenceDate: Date): Result<Charge> {
    if (this._status !== "ISSUED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A charge with status ${this._status} cannot become overdue`,
        ),
      );
    }

    const days = this.daysLateAt(referenceDate);
    if (days <= 0) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "The charge due date has not passed yet",
        ),
      );
    }

    this._status = "OVERDUE";
    this.setUpdatedAt();
    this.raiseEvent(
      new ChargeOverdue(
        this.id,
        this._companyId,
        this._personId,
        this._dueDate,
        days,
      ),
    );

    return Result.success(this);
  }

  /**
   * Settles the charge. The amount must equal the total due computed for the
   * receipt date — partial settlement is not supported.
   */
  registerReceipt(amount: Money, receivedAt: Date): Result<AmountsDue> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A charge with status ${this._status} cannot be settled`,
        ),
      );
    }

    if (amount.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Received amount currency ${amount.currency} does not match ${this._currency}`,
        ),
      );
    }

    const due = this.amountsDueAt(receivedAt);
    if (!amount.equals(due.totalDue)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Received amount ${amount.toDecimalString()} does not match the total due of ${due.totalDue.toDecimalString()} on the receipt date`,
        ),
      );
    }

    this._status = "PAID";
    this._paidAt = receivedAt;
    this.setUpdatedAt();
    this.raiseEvent(
      new ChargePaid(
        this.id,
        this._companyId,
        this._personId,
        amount,
        due.penalty,
        due.interest,
        receivedAt,
      ),
    );

    return Result.success(due);
  }

  /**
   * Cancels the charge. No transaction is created and none is reversed.
   */
  cancel(reason: string, cancelledAt: Date = new Date()): Result<Charge> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A charge with status ${this._status} cannot be cancelled`,
        ),
      );
    }

    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "A cancellation reason is required",
        ),
      );
    }

    this._status = "CANCELLED";
    this._cancelReason = trimmed;
    this._cancelledAt = cancelledAt;
    this.setUpdatedAt();
    this.raiseEvent(
      new ChargeCancelled(
        this.id,
        this._companyId,
        this._personId,
        trimmed,
      ),
    );

    return Result.success(this);
  }

  /**
   * Edits the charge. Allowed only while ISSUED: once it is overdue, the
   * customer has already been told what is owed.
   */
  edit(input: EditChargeInput): Result<Charge> {
    if (this._status !== "ISSUED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A charge with status ${this._status} cannot be edited`,
        ),
      );
    }

    try {
      let amount = this._amount;
      if (input.amount !== undefined) {
        amount = Money.create(input.amount, this._currency);
        if (!amount.isPositive()) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Charge amount must be greater than zero",
          );
        }
      }

      let dueDate = this._dueDate;
      if (input.dueDate !== undefined) {
        dueDate = atMidnight(input.dueDate);
        if (dueDate.getTime() < this._issueDate.getTime()) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Charge due date cannot be earlier than its issue date",
          );
        }
      }

      const penaltyPercent =
        input.penaltyPercent === undefined
          ? this._penaltyPercent
          : Percent.create(input.penaltyPercent);

      const monthlyInterestPercent =
        input.monthlyInterestPercent === undefined
          ? this._monthlyInterestPercent
          : Percent.create(input.monthlyInterestPercent);

      if (input.description !== undefined) {
        this._description =
          input.description === null
            ? undefined
            : input.description.trim() || undefined;
      }

      this._amount = amount;
      this._dueDate = dueDate;
      this._penaltyPercent = penaltyPercent;
      this._monthlyInterestPercent = monthlyInterestPercent;
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    this.setUpdatedAt();
    this.raiseEvent(
      new ChargeEdited(this.id, this._companyId, this._amount, this._dueDate),
    );
    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      personId: this._personId,
      amount: this._amount.amount,
      currency: this._currency,
      issueDate: this._issueDate,
      dueDate: this._dueDate,
      description: this._description,
      penaltyPercent: this._penaltyPercent.value,
      monthlyInterestPercent: this._monthlyInterestPercent.value,
      status: this._status,
      externalReference: this._externalReference,
      cancelReason: this._cancelReason,
      cancelledAt: this._cancelledAt,
      paidAt: this._paidAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Issues a charge to an active customer of the same company.
   */
  static issue(input: IssueChargeInput): Result<Charge> {
    try {
      const customer = input.customer;

      if (customer.companyId !== input.companyId) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A charge can only be issued to a person of the same company",
        );
      }

      if (!customer.hasRole("CUSTOMER")) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "A charge can only be issued to a person classified as CUSTOMER",
        );
      }

      if (!customer.isActive) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "A charge cannot be issued to an inactive customer",
        );
      }

      const currency = normalizeCurrency(input.currency);

      const charge = new Charge({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        personId: customer.id,
        amount: Money.create(input.amount, currency),
        currency,
        issueDate: input.issueDate ?? new Date(),
        dueDate: input.dueDate,
        description: input.description,
        penaltyPercent:
          input.penaltyPercent === undefined
            ? undefined
            : Percent.create(input.penaltyPercent),
        monthlyInterestPercent:
          input.monthlyInterestPercent === undefined
            ? undefined
            : Percent.create(input.monthlyInterestPercent),
      });

      charge.raiseEvent(
        new ChargeIssued(
          charge.id,
          charge.companyId,
          charge.personId,
          charge.amount,
          charge.dueDate,
        ),
      );

      return Result.success(charge);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
