import { randomUUID } from "node:crypto";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { toUtcDate } from "./date-math.js";
import { Money } from "./money.js";

/**
 * Installment lifecycle. Paid is final.
 */
export type LoanInstallmentStatus = "PENDING" | "OVERDUE" | "PAID";

const OPEN_STATUSES: ReadonlySet<LoanInstallmentStatus> = new Set<
  LoanInstallmentStatus
>(["PENDING", "OVERDUE"]);

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface LoanInstallmentProps {
  id: string;
  companyId: string;
  loanId: string;
  number: number;
  dueDate: Date;
  amount: Money;
  interestAmount: Money;
  principalAmount: Money;
  status?: LoanInstallmentStatus;
  paidAt?: Date | undefined;
  createdAt?: Date;
}

/**
 * One installment of a loan's amortization schedule.
 *
 * An entity, not a projection: it carries its own status, its own due date and
 * the payment that settled it — the same reasoning as the Phase 1 installments.
 * The interest and principal portions are frozen when the loan is contracted.
 */
export class LoanInstallment extends Entity<string> {
  private readonly _companyId: string;
  private readonly _loanId: string;
  private readonly _number: number;
  private _dueDate: Date;
  private readonly _amount: Money;
  private readonly _interestAmount: Money;
  private _principalAmount: Money;
  private _status: LoanInstallmentStatus;
  private _paidAt: Date | undefined;

  constructor(props: LoanInstallmentProps) {
    super(props.id, props.createdAt);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Loan installment requires a company",
      );
    }

    if (!Number.isInteger(props.number) || props.number < 1) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid installment number: ${props.number}`,
      );
    }

    if (Number.isNaN(props.dueDate.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid due date");
    }

    this._companyId = props.companyId;
    this._loanId = props.loanId;
    this._number = props.number;
    this._dueDate = toUtcDate(props.dueDate);
    this._amount = props.amount;
    this._interestAmount = props.interestAmount;
    this._principalAmount = props.principalAmount;
    this._status = props.status ?? "PENDING";
    this._paidAt = props.paidAt;
  }

  get companyId(): string {
    return this._companyId;
  }

  get loanId(): string {
    return this._loanId;
  }

  get number(): number {
    return this._number;
  }

  get dueDate(): Date {
    return new Date(this._dueDate.getTime());
  }

  get amount(): Money {
    return this._amount;
  }

  get interestAmount(): Money {
    return this._interestAmount;
  }

  /**
   * The part of the installment that repays the debt. An extra amortization may
   * reduce it when it covers part — but not all — of this installment.
   */
  get principalAmount(): Money {
    return this._principalAmount;
  }

  get status(): LoanInstallmentStatus {
    return this._status;
  }

  get paidAt(): Date | undefined {
    return this._paidAt;
  }

  get isOpen(): boolean {
    return OPEN_STATUSES.has(this._status);
  }

  get isPaid(): boolean {
    return this._status === "PAID";
  }

  /**
   * Days past the due date at a reference date; zero while it is not late.
   */
  daysLateAt(referenceDate: Date): number {
    const reference = toUtcDate(referenceDate).getTime();
    const due = this._dueDate.getTime();
    return reference <= due ? 0 : Math.floor((reference - due) / DAY_IN_MS);
  }

  /**
   * Pending → Overdue. Rejected for anything else, which is what makes the
   * daily detection pass idempotent without a job control table.
   */
  markOverdue(referenceDate: Date): Result<LoanInstallment> {
    if (this._status !== "PENDING") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Installment ${this._number} is ${this._status} and cannot be flagged overdue`,
        ),
      );
    }

    if (toUtcDate(referenceDate).getTime() <= this._dueDate.getTime()) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Installment ${this._number} is not past its due date`,
        ),
      );
    }

    this._status = "OVERDUE";
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Pending or Overdue → Paid. A second payment is rejected here, and rejected
   * again by the status-guarded UPDATE in the repository.
   */
  registerPayment(amount: Money, paidAt: Date): Result<LoanInstallment> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Installment ${this._number} is already ${this._status}`,
        ),
      );
    }

    if (amount.currency !== this._amount.currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment currency ${amount.currency} does not match installment currency ${this._amount.currency}`,
        ),
      );
    }

    if (!amount.equals(this._amount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Installment ${this._number} is due ${this._amount.toDecimalString()}, not ${amount.toDecimalString()}`,
        ),
      );
    }

    this._status = "PAID";
    this._paidAt = paidAt;
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Settles the installment through an extra amortization rather than a regular
   * payment: no transaction of its own, the amortization already moved money.
   */
  settleByAmortization(paidAt: Date): Result<LoanInstallment> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Installment ${this._number} is already ${this._status}`,
        ),
      );
    }

    this._status = "PAID";
    this._paidAt = paidAt;
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Reduces the principal portion when an amortization covers only part of this
   * installment; the installment itself stays open for its remainder.
   */
  reducePrincipal(amount: Money): Result<LoanInstallment> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Installment ${this._number} is already ${this._status}`,
        ),
      );
    }

    if (amount.greaterThan(this._principalAmount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Cannot reduce ${amount.toDecimalString()} from a principal portion of ${this._principalAmount.toDecimalString()}`,
        ),
      );
    }

    this._principalAmount = this._principalAmount.subtract(amount);
    this.setUpdatedAt();

    return Result.success(this);
  }

  changeDueDate(dueDate: Date): Result<LoanInstallment> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Installment ${this._number} is already ${this._status}`,
        ),
      );
    }

    if (Number.isNaN(dueDate.getTime())) {
      return Result.failed(
        DomainError.create("VALIDATION_ERROR", "Invalid due date"),
      );
    }

    this._dueDate = toUtcDate(dueDate);
    this.setUpdatedAt();

    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      loanId: this._loanId,
      number: this._number,
      dueDate: this._dueDate,
      amount: this._amount.amount,
      interestAmount: this._interestAmount.amount,
      principalAmount: this._principalAmount.amount,
      status: this._status,
      paidAt: this._paidAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static create(props: Omit<LoanInstallmentProps, "id"> & { id?: string }): LoanInstallment {
    return new LoanInstallment({ ...props, id: props.id ?? randomUUID() });
  }
}
