import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { addMonths, toUtcDate } from "./date-math.js";
import {
  InstallmentDueDateChanged,
  InstallmentOverdue,
  InstallmentPaid,
} from "./installment-events.js";
import { Money } from "./money.js";

/**
 * Installment lifecycle states.
 */
export type InstallmentStatus = "PENDING" | "PAID" | "OVERDUE";

const ALLOWED_TRANSITIONS: Readonly<
  Record<InstallmentStatus, readonly InstallmentStatus[]>
> = {
  PENDING: ["PAID", "OVERDUE"],
  OVERDUE: ["PAID"],
  PAID: [],
};

/**
 * Constructor properties for rehydrating an installment from persistence.
 */
export interface InstallmentProps {
  id: string;
  companyId: string;
  parentTransactionId: string;
  accountId: string;
  categoryId?: string | undefined;
  number: number;
  amount: Money;
  dueDate: Date;
  status?: InstallmentStatus;
  paymentDate?: Date | undefined;
  paymentTransactionId?: string | undefined;
  paymentAccountId?: string | undefined;
  createdAt?: Date;
}

/**
 * Input for generating the installments of a parceled purchase.
 */
export interface GenerateInstallmentsInput {
  companyId: string;
  parentTransactionId: string;
  accountId: string;
  categoryId?: string | undefined;
  total: Money;
  count: number;
  /** Reference date of the purchase; the first due date is one month later. */
  purchaseDate: Date;
}

/**
 * Installment entity.
 *
 * RN-05: each installment has a life of its own — its own status, due date and
 * payment — while every installment of the same purchase shares the parent
 * transaction as common origin. Paying one never touches the others.
 */
export class Installment extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _parentTransactionId: string;
  private readonly _accountId: string;
  private readonly _categoryId: string | undefined;
  private readonly _number: number;
  private readonly _amount: Money;
  private _dueDate: Date;
  private _status: InstallmentStatus;
  private _paymentDate: Date | undefined;
  private _paymentTransactionId: string | undefined;
  private _paymentAccountId: string | undefined;

  constructor(props: InstallmentProps) {
    super(props.id, props.createdAt);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Installment requires a company",
      );
    }

    if (props.parentTransactionId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Installment requires its parent transaction (RN-05)",
      );
    }

    if (props.accountId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Installment requires an account (RN-03)",
      );
    }

    if (!Number.isInteger(props.number) || props.number < 1) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Installment number must be a positive integer",
      );
    }

    if (!props.amount.isPositive()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Installment amount must be greater than zero",
      );
    }

    if (Number.isNaN(props.dueDate.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid due date");
    }

    const status = props.status ?? "PENDING";

    if (status === "PAID" && !props.paymentDate) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        "A paid installment requires a payment date",
      );
    }

    this._companyId = props.companyId;
    this._parentTransactionId = props.parentTransactionId;
    this._accountId = props.accountId;
    this._categoryId = props.categoryId;
    this._number = props.number;
    this._amount = props.amount;
    this._dueDate = toUtcDate(props.dueDate);
    this._status = status;
    this._paymentDate = props.paymentDate
      ? toUtcDate(props.paymentDate)
      : undefined;
    this._paymentTransactionId = props.paymentTransactionId;
    this._paymentAccountId = props.paymentAccountId;
  }

  get companyId(): string {
    return this._companyId;
  }

  get parentTransactionId(): string {
    return this._parentTransactionId;
  }

  /** Account of the original purchase. */
  get accountId(): string {
    return this._accountId;
  }

  get categoryId(): string | undefined {
    return this._categoryId;
  }

  get number(): number {
    return this._number;
  }

  get amount(): Money {
    return this._amount;
  }

  get dueDate(): Date {
    return new Date(this._dueDate.getTime());
  }

  get status(): InstallmentStatus {
    return this._status;
  }

  get paymentDate(): Date | undefined {
    return this._paymentDate
      ? new Date(this._paymentDate.getTime())
      : undefined;
  }

  get paymentTransactionId(): string | undefined {
    return this._paymentTransactionId;
  }

  /** Account the payment actually came from; may differ from the purchase account. */
  get paymentAccountId(): string | undefined {
    return this._paymentAccountId;
  }

  get isPending(): boolean {
    return this._status === "PENDING";
  }

  private ensureCanTransitionTo(
    next: InstallmentStatus,
  ): DomainError | undefined {
    if (ALLOWED_TRANSITIONS[this._status].includes(next)) {
      return undefined;
    }
    return DomainError.create(
      "INVALID_OPERATION",
      `Cannot transition installment from ${this._status} to ${next}`,
    );
  }

  /**
   * Settles the installment. The payment account may differ from the account of
   * the original purchase; the caller creates the payment transaction and passes
   * its id so the installment stays linked to it.
   */
  pay(
    paymentDate: Date,
    accountId: string,
    paymentTransactionId?: string,
  ): Result<Installment> {
    const error = this.ensureCanTransitionTo("PAID");
    if (error) {
      return Result.failed(error);
    }

    if (Number.isNaN(paymentDate.getTime())) {
      return Result.failed(
        DomainError.create("VALIDATION_ERROR", "Invalid payment date"),
      );
    }

    if (accountId.trim().length === 0) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "Installment payment requires an account (RN-03)",
        ),
      );
    }

    this._status = "PAID";
    this._paymentDate = toUtcDate(paymentDate);
    this._paymentAccountId = accountId;
    this._paymentTransactionId = paymentTransactionId;
    this.setUpdatedAt();
    this.raiseEvent(
      new InstallmentPaid(
        this.id,
        this._companyId,
        this._parentTransactionId,
        this._number,
        this._amount,
        this._paymentDate,
        accountId,
      ),
    );

    return Result.success(this);
  }

  /**
   * Flags a pending installment whose due date has passed.
   */
  markOverdue(referenceDate: Date = new Date()): Result<Installment> {
    const error = this.ensureCanTransitionTo("OVERDUE");
    if (error) {
      return Result.failed(error);
    }

    if (toUtcDate(referenceDate).getTime() <= this._dueDate.getTime()) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Installment is not overdue yet",
        ),
      );
    }

    this._status = "OVERDUE";
    this.setUpdatedAt();
    this.raiseEvent(
      new InstallmentOverdue(
        this.id,
        this._companyId,
        this._parentTransactionId,
        this._number,
        this.dueDate,
      ),
    );

    return Result.success(this);
  }

  /**
   * Changes the due date of a pending installment, raising an event for auditing.
   */
  changeDueDate(newDate: Date): Result<Installment> {
    if (this._status !== "PENDING") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Only pending installments can have their due date changed; this one is ${this._status}`,
        ),
      );
    }

    if (Number.isNaN(newDate.getTime())) {
      return Result.failed(
        DomainError.create("VALIDATION_ERROR", "Invalid due date"),
      );
    }

    const normalized = toUtcDate(newDate);
    if (normalized.getTime() === this._dueDate.getTime()) {
      return Result.success(this);
    }

    const oldDueDate = this.dueDate;
    this._dueDate = normalized;
    this.setUpdatedAt();
    this.raiseEvent(
      new InstallmentDueDateChanged(
        this.id,
        this._companyId,
        oldDueDate,
        this.dueDate,
      ),
    );

    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      parentTransactionId: this._parentTransactionId,
      accountId: this._accountId,
      categoryId: this._categoryId,
      number: this._number,
      amount: this._amount.amount,
      currency: this._amount.currency,
      dueDate: this._dueDate,
      status: this._status,
      paymentDate: this._paymentDate,
      paymentTransactionId: this._paymentTransactionId,
      paymentAccountId: this._paymentAccountId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * RN-05 guard: every installment of a set must point at the same parent and
   * their amounts must add up to the parent total, with numbers 1..N unique.
   */
  static ensureSharedOrigin(
    installments: readonly Installment[],
    parentTransactionId: string,
    total: Money,
  ): Result<readonly Installment[]> {
    if (installments.length === 0) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "A parceled purchase requires at least one installment",
        ),
      );
    }

    const numbers = new Set<number>();

    for (const installment of installments) {
      if (installment.parentTransactionId !== parentTransactionId) {
        return Result.failed(
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            `Installment ${installment.id} does not belong to transaction ${parentTransactionId} (RN-05)`,
          ),
        );
      }
      if (installment.amount.currency !== total.currency) {
        return Result.failed(
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "All installments must share the currency of the parent transaction",
          ),
        );
      }
      if (numbers.has(installment.number)) {
        return Result.failed(
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            `Duplicate installment number ${installment.number} (RN-05)`,
          ),
        );
      }
      numbers.add(installment.number);
    }

    for (let number = 1; number <= installments.length; number += 1) {
      if (!numbers.has(number)) {
        return Result.failed(
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            `Missing installment number ${number} (RN-05)`,
          ),
        );
      }
    }

    const sum = Money.sum(
      total.currency,
      installments.map((installment) => installment.amount),
    );

    if (!sum.equals(total)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Installments total ${sum.toDecimalString()} does not match the parent amount ${total.toDecimalString()} (RN-05)`,
        ),
      );
    }

    return Result.success(installments);
  }

  /**
   * Generates N installments with consecutive monthly due dates starting one
   * month after the purchase. Rounding leftovers land on the first installment
   * so the set always adds up to the parent total.
   */
  static generate(input: GenerateInstallmentsInput): Result<Installment[]> {
    if (!Number.isInteger(input.count) || input.count < 1) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "Installment count must be a positive integer",
        ),
      );
    }

    if (!input.total.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "Parceled purchase amount must be greater than zero",
        ),
      );
    }

    if (Number.isNaN(input.purchaseDate.getTime())) {
      return Result.failed(
        DomainError.create("VALIDATION_ERROR", "Invalid purchase date"),
      );
    }

    const currency = input.total.currency;
    const baseCents = Math.floor(input.total.cents / input.count);
    const remainderCents = input.total.cents - baseCents * input.count;

    if (baseCents === 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Parceled purchase amount is too small for the requested number of installments",
        ),
      );
    }

    try {
      const installments = Array.from({ length: input.count }, (_, index) => {
        const cents = index === 0 ? baseCents + remainderCents : baseCents;
        return new Installment({
          id: randomUUID(),
          companyId: input.companyId,
          parentTransactionId: input.parentTransactionId,
          accountId: input.accountId,
          categoryId: input.categoryId,
          number: index + 1,
          amount: Money.fromCents(cents, currency),
          dueDate: addMonths(input.purchaseDate, index + 1),
        });
      });

      return Installment.ensureSharedOrigin(
        installments,
        input.parentTransactionId,
        input.total,
      ).isSuccess
        ? Result.success(installments)
        : Result.failed(
            DomainError.create(
              "BUSINESS_RULE_VIOLATION",
              "Generated installments do not satisfy RN-05",
            ),
          );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
