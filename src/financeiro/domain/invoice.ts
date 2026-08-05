import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import type { Card } from "./card.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { toUtcDate } from "./date-math.js";
import { closingDateFor, cycleStartFor, dueDateFor } from "./invoice-cycle.js";
import { InvoiceClosed, InvoiceOverdue, InvoicePaid } from "./invoice-events.js";
import { Money } from "./money.js";

/**
 * Invoice lifecycle states.
 */
export type InvoiceStatus =
  | "OPEN"
  | "CLOSED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE";

/**
 * Allowed state transitions. Anything not listed here is rejected — in
 * particular, leaving PAID and going back from CLOSED to OPEN.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<InvoiceStatus, readonly InvoiceStatus[]>
> = {
  OPEN: ["CLOSED", "PAID"],
  CLOSED: ["PAID", "PARTIALLY_PAID", "OVERDUE"],
  PARTIALLY_PAID: ["PAID", "OVERDUE"],
  OVERDUE: ["PARTIALLY_PAID", "PAID"],
  PAID: [],
};

const INVOICE_STATUSES: ReadonlySet<string> = new Set<InvoiceStatus>([
  "OPEN",
  "CLOSED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
]);

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Constructor properties for rehydrating an invoice from persistence.
 */
export interface InvoiceProps {
  id: string;
  companyId: string;
  cardId: string;
  accountId: string;
  cycleStart: Date;
  closingDate: Date;
  dueDate: Date;
  currency: string;
  status?: InvoiceStatus;
  totalAmount?: Money;
  paidAmount?: Money;
  closedAt?: Date | undefined;
  closedBy?: string | undefined;
  createdAt?: Date;
}

/**
 * Input for opening the invoice of a card cycle.
 */
export interface OpenInvoiceInput {
  id?: string;
  companyId: string;
  card: Card;
  purchaseDate: Date;
}

/**
 * Invoice aggregate root.
 *
 * Owns the state machine and the money arithmetic; the coordination with other
 * aggregates (debiting an account, creating the payment transaction) belongs to
 * `InvoicePaymentService`, in the same split used by `TransferService`.
 *
 * The cycle dates are materialized at opening time so that a later change of the
 * card's closing day only affects the cycles opened after it.
 */
export class Invoice extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _cardId: string;
  private readonly _accountId: string;
  private readonly _cycleStart: Date;
  private readonly _closingDate: Date;
  private readonly _dueDate: Date;
  private readonly _currency: string;
  private _status: InvoiceStatus;
  private _totalAmount: Money;
  private _paidAmount: Money;
  private _closedAt: Date | undefined;
  private _closedBy: string | undefined;

  constructor(props: InvoiceProps) {
    super(props.id, props.createdAt);

    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Invoice requires a company",
      );
    }

    if (props.cardId.trim().length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Invoice requires a card");
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    const status = props.status ?? "OPEN";
    if (!INVOICE_STATUSES.has(status)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid invoice status: ${status}`,
      );
    }

    for (const [label, date] of [
      ["cycle start", props.cycleStart],
      ["closing date", props.closingDate],
      ["due date", props.dueDate],
    ] as const) {
      if (Number.isNaN(date.getTime())) {
        throw DomainError.create("VALIDATION_ERROR", `Invalid invoice ${label}`);
      }
    }

    const totalAmount = props.totalAmount ?? Money.zero(currency);
    const paidAmount = props.paidAmount ?? Money.zero(currency);

    for (const [label, value] of [
      ["total", totalAmount],
      ["paid", paidAmount],
    ] as const) {
      if (value.currency !== currency) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Invoice ${label} amount currency ${value.currency} does not match ${currency}`,
        );
      }
      if (value.isNegative()) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          `Invoice ${label} amount cannot be negative`,
        );
      }
    }

    this._companyId = props.companyId;
    this._cardId = props.cardId;
    this._accountId = props.accountId;
    this._cycleStart = toUtcDate(props.cycleStart);
    this._closingDate = toUtcDate(props.closingDate);
    this._dueDate = toUtcDate(props.dueDate);
    this._currency = currency;
    this._status = status;
    this._totalAmount = totalAmount;
    this._paidAmount = paidAmount;
    this._closedAt = props.closedAt;
    this._closedBy = props.closedBy;
  }

  get companyId(): string {
    return this._companyId;
  }

  get cardId(): string {
    return this._cardId;
  }

  get accountId(): string {
    return this._accountId;
  }

  get cycleStart(): Date {
    return new Date(this._cycleStart.getTime());
  }

  get closingDate(): Date {
    return new Date(this._closingDate.getTime());
  }

  get dueDate(): Date {
    return new Date(this._dueDate.getTime());
  }

  get currency(): string {
    return this._currency;
  }

  get status(): InvoiceStatus {
    return this._status;
  }

  get total(): Money {
    return this._totalAmount;
  }

  get paidAmount(): Money {
    return this._paidAmount;
  }

  /**
   * What is still owed on this invoice.
   */
  get outstanding(): Money {
    return this._totalAmount.subtract(this._paidAmount);
  }

  get closedAt(): Date | undefined {
    return this._closedAt;
  }

  get closedBy(): string | undefined {
    return this._closedBy;
  }

  get isOpen(): boolean {
    return this._status === "OPEN";
  }

  /**
   * Whether the invoice still counts against the card's available limit.
   */
  get isSettled(): boolean {
    return this._status === "PAID";
  }

  /**
   * Whether the purchases linked to this invoice are frozen against edits.
   */
  get isBilled(): boolean {
    return this._status !== "OPEN";
  }

  /**
   * Whether `date` falls inside this invoice's billing cycle.
   */
  covers(date: Date): boolean {
    const time = toUtcDate(date).getTime();
    return (
      time >= this._cycleStart.getTime() && time <= this._closingDate.getTime()
    );
  }

  private ensureCanTransitionTo(next: InvoiceStatus): DomainError | undefined {
    if (ALLOWED_TRANSITIONS[this._status].includes(next)) {
      return undefined;
    }

    if (this._status === "PAID") {
      return DomainError.create(
        "INVALID_OPERATION",
        "A paid invoice cannot change state",
      );
    }

    if (next === "OPEN") {
      return DomainError.create(
        "INVALID_OPERATION",
        "A closed invoice cannot be reopened",
      );
    }

    return DomainError.create(
      "INVALID_OPERATION",
      `Cannot transition invoice from ${this._status} to ${next}`,
    );
  }

  /**
   * Open → Closed. Consolidates the cycle's purchases into a single obligation.
   * An empty cycle closes already paid, since there is nothing to settle.
   */
  close(
    purchaseTotal: Money,
    transactionIds: readonly string[],
    closedBy?: string,
  ): Result<Invoice> {
    if (purchaseTotal.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Purchase total currency ${purchaseTotal.currency} does not match invoice currency ${this._currency}`,
        ),
      );
    }

    if (purchaseTotal.isNegative()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The consolidated purchase total cannot be negative",
        ),
      );
    }

    const target: InvoiceStatus = purchaseTotal.isZero() ? "PAID" : "CLOSED";
    const error = this.ensureCanTransitionTo(target);
    if (error) {
      return Result.failed(error);
    }

    this._totalAmount = purchaseTotal;
    this._status = target;
    this._closedAt = new Date();
    this._closedBy = closedBy;
    this.setUpdatedAt();

    this.raiseEvent(
      new InvoiceClosed(
        this.id,
        this._companyId,
        this._cardId,
        this._accountId,
        this._totalAmount,
        this._currency,
        this.dueDate,
        this.closingDate,
        [...transactionIds],
      ),
    );

    if (target === "PAID") {
      this.raiseEvent(
        new InvoicePaid(
          this.id,
          this._companyId,
          this._cardId,
          this._totalAmount,
          this._paidAmount,
          this._closedAt,
        ),
      );
    }

    return Result.success(this);
  }

  /**
   * Registers a total or partial payment. The obligation only exists after
   * closing, so an OPEN invoice cannot be paid, and PAID accepts nothing more.
   */
  registerPayment(amount: Money, paidAt: Date = new Date()): Result<Invoice> {
    if (amount.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment currency ${amount.currency} does not match invoice currency ${this._currency}`,
        ),
      );
    }

    if (!amount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The payment amount must be greater than zero",
        ),
      );
    }

    if (this._status === "OPEN") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An open invoice cannot be paid; the obligation only exists after closing",
        ),
      );
    }

    if (this._status === "PAID") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A paid invoice does not accept further payments",
        ),
      );
    }

    if (amount.greaterThan(this.outstanding)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment of ${amount.toDecimalString()} exceeds the outstanding balance of ${this.outstanding.toDecimalString()}`,
        ),
      );
    }

    const paid = this._paidAmount.add(amount);
    const settled = paid.greaterThanOrEqual(this._totalAmount);
    const target: InvoiceStatus = settled ? "PAID" : "PARTIALLY_PAID";

    const error = this.ensureCanTransitionTo(target);
    if (error) {
      return Result.failed(error);
    }

    this._paidAmount = paid;
    this._status = target;
    this.setUpdatedAt();

    if (settled) {
      this.raiseEvent(
        new InvoicePaid(
          this.id,
          this._companyId,
          this._cardId,
          this._totalAmount,
          this._paidAmount,
          paidAt,
        ),
      );
    }

    return Result.success(this);
  }

  /**
   * Flags a closed or partially paid invoice whose due date has passed. Calling
   * it again is a no-op failure, which is what makes the scheduler idempotent.
   */
  markOverdue(referenceDate: Date = new Date()): Result<Invoice> {
    const error = this.ensureCanTransitionTo("OVERDUE");
    if (error) {
      return Result.failed(error);
    }

    const reference = toUtcDate(referenceDate);
    if (reference.getTime() <= this._dueDate.getTime()) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "The invoice due date has not passed yet",
        ),
      );
    }

    if (!this.outstanding.isPositive()) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An invoice with no outstanding balance cannot be overdue",
        ),
      );
    }

    const overdueDays = Math.floor(
      (reference.getTime() - this._dueDate.getTime()) / MILLISECONDS_PER_DAY,
    );

    this._status = "OVERDUE";
    this.setUpdatedAt();
    this.raiseEvent(
      new InvoiceOverdue(
        this.id,
        this._companyId,
        this._cardId,
        this.dueDate,
        this.outstanding,
        overdueDays,
      ),
    );

    return Result.success(this);
  }

  /**
   * Reduces the total of a closed, unpaid invoice when one of its purchases is
   * refunded. A paid invoice is untouched — the refund is settled elsewhere.
   */
  adjustForRefund(amount: Money): Result<Invoice> {
    if (amount.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Refund currency ${amount.currency} does not match invoice currency ${this._currency}`,
        ),
      );
    }

    if (!amount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The refunded amount must be greater than zero",
        ),
      );
    }

    if (this._status === "OPEN") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An open invoice has no consolidated total to adjust",
        ),
      );
    }

    if (this._status === "PAID") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A paid invoice cannot be adjusted by a refund",
        ),
      );
    }

    if (amount.greaterThan(this.outstanding)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Refund of ${amount.toDecimalString()} exceeds the outstanding balance of ${this.outstanding.toDecimalString()}`,
        ),
      );
    }

    this._totalAmount = this._totalAmount.subtract(amount);
    this.setUpdatedAt();

    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      cardId: this._cardId,
      accountId: this._accountId,
      cycleStart: this.cycleStart,
      closingDate: this.closingDate,
      dueDate: this.dueDate,
      status: this._status,
      totalAmount: this._totalAmount.amount,
      paidAmount: this._paidAmount.amount,
      outstanding: this.outstanding.amount,
      currency: this._currency,
      closedAt: this._closedAt,
      closedBy: this._closedBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Opens the invoice of the cycle that contains `purchaseDate`, deriving and
   * materializing the cycle dates from the card's closing and due days.
   */
  static open(input: OpenInvoiceInput): Result<Invoice> {
    const { card } = input;

    if (!card.isCredit) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Only credit cards consolidate purchases into invoices",
        ),
      );
    }

    const closingDay = card.closingDay;
    const dueDay = card.dueDay;
    if (closingDay === undefined || dueDay === undefined) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "A credit card requires a closing day and a due day to open an invoice",
        ),
      );
    }

    try {
      const closingDate = closingDateFor(input.purchaseDate, closingDay);

      return Result.success(
        new Invoice({
          id: input.id ?? randomUUID(),
          companyId: input.companyId,
          cardId: card.id,
          accountId: card.accountId,
          cycleStart: cycleStartFor(closingDate, closingDay),
          closingDate,
          dueDate: dueDateFor(closingDate, dueDay),
          currency: card.currency,
          status: "OPEN",
        }),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
