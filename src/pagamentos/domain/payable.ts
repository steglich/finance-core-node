import { randomUUID } from "node:crypto";
import {
  isSupportedCurrency,
  normalizeCurrency,
} from "../../financeiro/domain/currency.js";
import { Money } from "../../financeiro/domain/money.js";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { daysLate } from "./charge-math.js";
import {
  PayableCancelled,
  PayableEdited,
  PayableOverdue,
  PayablePaid,
  PayableRegistered,
} from "./payable-events.js";

/**
 * Payable lifecycle. PAID and CANCELLED are final.
 * Mirrors `ChargeStatus`, with PENDING where a charge is ISSUED.
 */
export type PayableStatus = "PENDING" | "OVERDUE" | "PAID" | "CANCELLED";

const OPEN_STATUSES: ReadonlySet<PayableStatus> = new Set<PayableStatus>([
  "PENDING",
  "OVERDUE",
]);

/**
 * The subset of a person a payable needs to validate its supplier.
 * `Person` satisfies it structurally — no import from `cadastros`.
 */
export interface PayableSupplier {
  id: string;
  companyId: string;
  isActive: boolean;
  hasRole(role: "CUSTOMER" | "SUPPLIER" | "PAYEE"): boolean;
}

/**
 * The subset of a category a payable needs. `Category` satisfies it.
 */
export interface PayableCategory {
  id: string;
  companyId: string;
  type: string;
}

/**
 * Constructor properties for rehydrating a payable from persistence.
 */
export interface PayableProps {
  id: string;
  companyId: string;
  personId: string;
  categoryId: string;
  costCenterId?: string | undefined;
  amount: Money;
  currency: string;
  dueDate: Date;
  competenceDate?: Date | undefined;
  description?: string | undefined;
  documentNumber?: string | undefined;
  status?: PayableStatus;
  cancelReason?: string | undefined;
  cancelledAt?: Date | undefined;
  paidAt?: Date | undefined;
  createdAt?: Date;
}

/**
 * Input for registering a new payable.
 */
export interface RegisterPayableInput {
  id?: string;
  companyId: string;
  supplier: PayableSupplier;
  category: PayableCategory;
  costCenterId?: string | undefined;
  amount: number;
  currency: string;
  dueDate: Date;
  competenceDate?: Date | undefined;
  description?: string | undefined;
  documentNumber?: string | undefined;
}

/**
 * Mutable fields of a payable, editable only while it is PENDING.
 */
export interface EditPayableInput {
  amount?: number | undefined;
  dueDate?: Date | undefined;
  categoryId?: string | undefined;
  costCenterId?: string | null | undefined;
  description?: string | null | undefined;
}

function atMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Accounts payable aggregate: an obligation of the company towards a supplier.
 *
 * The mirror image of `Charge`, minus penalty and interest — what a supplier
 * charges for lateness is their document, not something this system derives.
 */
export class Payable extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _personId: string;
  private readonly _currency: string;
  private _categoryId: string;
  private _costCenterId: string | undefined;
  private _amount: Money;
  private _dueDate: Date;
  private _competenceDate: Date | undefined;
  private _description: string | undefined;
  private _documentNumber: string | undefined;
  private _status: PayableStatus;
  private _cancelReason: string | undefined;
  private _cancelledAt: Date | undefined;
  private _paidAt: Date | undefined;

  constructor(props: PayableProps) {
    super(props.id, props.createdAt);

    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Payable requires a company",
      );
    }

    if (props.personId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Payable requires a supplier",
      );
    }

    if (props.categoryId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Payable requires a category",
      );
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
        "Payable amount must be greater than zero",
      );
    }

    if (props.amount.currency !== currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Payable amount currency ${props.amount.currency} does not match ${currency}`,
      );
    }

    this._companyId = props.companyId;
    this._personId = props.personId;
    this._categoryId = props.categoryId;
    this._costCenterId = props.costCenterId;
    this._currency = currency;
    this._amount = props.amount;
    // A past due date is accepted: an obligation may be recorded late.
    this._dueDate = atMidnight(props.dueDate);
    this._competenceDate = props.competenceDate
      ? atMidnight(props.competenceDate)
      : undefined;
    this._description = props.description?.trim() || undefined;
    this._documentNumber = props.documentNumber?.trim() || undefined;
    this._status = props.status ?? "PENDING";
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

  get categoryId(): string {
    return this._categoryId;
  }

  get costCenterId(): string | undefined {
    return this._costCenterId;
  }

  get amount(): Money {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  get dueDate(): Date {
    return this._dueDate;
  }

  get competenceDate(): Date | undefined {
    return this._competenceDate;
  }

  get description(): string | undefined {
    return this._description;
  }

  get documentNumber(): string | undefined {
    return this._documentNumber;
  }

  get status(): PayableStatus {
    return this._status;
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

  get isOpen(): boolean {
    return OPEN_STATUSES.has(this._status);
  }

  daysLateAt(referenceDate: Date): number {
    return daysLate(this._dueDate, referenceDate);
  }

  /**
   * Marks the payable overdue. Idempotent by the state machine, exactly as the
   * charge is, which is what makes the daily pass safe to re-run.
   */
  markOverdue(referenceDate: Date): Result<Payable> {
    if (this._status !== "PENDING") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A payable with status ${this._status} cannot become overdue`,
        ),
      );
    }

    const days = this.daysLateAt(referenceDate);
    if (days <= 0) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "The payable due date has not passed yet",
        ),
      );
    }

    this._status = "OVERDUE";
    this.setUpdatedAt();
    this.raiseEvent(
      new PayableOverdue(
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
   * Settles the payable. The amount must equal the full amount owed — partial
   * settlement is not supported.
   */
  registerPayment(amount: Money, paidAt: Date): Result<Payable> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A payable with status ${this._status} cannot be settled`,
        ),
      );
    }

    if (amount.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment currency ${amount.currency} does not match ${this._currency}`,
        ),
      );
    }

    if (!amount.equals(this._amount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment of ${amount.toDecimalString()} does not match the payable amount of ${this._amount.toDecimalString()}`,
        ),
      );
    }

    this._status = "PAID";
    this._paidAt = paidAt;
    this.setUpdatedAt();
    this.raiseEvent(
      new PayablePaid(
        this.id,
        this._companyId,
        this._personId,
        amount,
        paidAt,
      ),
    );

    return Result.success(this);
  }

  /**
   * Cancels the payable. No transaction is created and none is reversed.
   */
  cancel(reason: string, cancelledAt: Date = new Date()): Result<Payable> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A payable with status ${this._status} cannot be cancelled`,
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
      new PayableCancelled(
        this.id,
        this._companyId,
        this._personId,
        trimmed,
      ),
    );

    return Result.success(this);
  }

  /**
   * Edits the payable. Allowed only while PENDING.
   *
   * The category and cost center are validated by the caller — the payable only
   * knows it must not be left without a category.
   */
  edit(input: EditPayableInput): Result<Payable> {
    if (this._status !== "PENDING") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A payable with status ${this._status} cannot be edited`,
        ),
      );
    }

    try {
      if (input.amount !== undefined) {
        const amount = Money.create(input.amount, this._currency);
        if (!amount.isPositive()) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Payable amount must be greater than zero",
          );
        }
        this._amount = amount;
      }

      if (input.dueDate !== undefined) {
        this._dueDate = atMidnight(input.dueDate);
      }

      if (input.categoryId !== undefined) {
        const categoryId = input.categoryId.trim();
        if (categoryId.length === 0) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Payable requires a category",
          );
        }
        this._categoryId = categoryId;
      }

      if (input.costCenterId !== undefined) {
        this._costCenterId =
          input.costCenterId === null
            ? undefined
            : input.costCenterId.trim() || undefined;
      }

      if (input.description !== undefined) {
        this._description =
          input.description === null
            ? undefined
            : input.description.trim() || undefined;
      }
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    this.setUpdatedAt();
    this.raiseEvent(
      new PayableEdited(this.id, this._companyId, this._amount, this._dueDate),
    );
    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      personId: this._personId,
      categoryId: this._categoryId,
      costCenterId: this._costCenterId,
      amount: this._amount.amount,
      currency: this._currency,
      dueDate: this._dueDate,
      competenceDate: this._competenceDate,
      description: this._description,
      documentNumber: this._documentNumber,
      status: this._status,
      cancelReason: this._cancelReason,
      cancelledAt: this._cancelledAt,
      paidAt: this._paidAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Registers an obligation towards an active supplier of the same company,
   * classified under an expense category of that company.
   */
  static register(input: RegisterPayableInput): Result<Payable> {
    try {
      const { supplier, category } = input;

      if (supplier.companyId !== input.companyId) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A payable can only be registered for a person of the same company",
        );
      }

      if (!supplier.hasRole("SUPPLIER")) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "A payable can only be registered for a person classified as SUPPLIER",
        );
      }

      if (!supplier.isActive) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "A payable cannot be registered for an inactive supplier",
        );
      }

      if (category.companyId !== input.companyId) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A payable can only use a category of the same company",
        );
      }

      if (category.type !== "EXPENSE") {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "A payable requires an expense category",
        );
      }

      const currency = normalizeCurrency(input.currency);

      const payable = new Payable({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        personId: supplier.id,
        categoryId: category.id,
        costCenterId: input.costCenterId,
        amount: Money.create(input.amount, currency),
        currency,
        dueDate: input.dueDate,
        competenceDate: input.competenceDate,
        description: input.description,
        documentNumber: input.documentNumber,
      });

      payable.raiseEvent(
        new PayableRegistered(
          payable.id,
          payable.companyId,
          payable.personId,
          payable.categoryId,
          payable.amount,
          payable.dueDate,
        ),
      );

      return Result.success(payable);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
