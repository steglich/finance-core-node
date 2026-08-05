import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { toUtcDate } from "./date-math.js";
import { LoanCreated, LoanSettled } from "./loan-events.js";
import { LoanInstallment } from "./loan-installment.js";
import { buildSchedule } from "./loan-math.js";
import { Money } from "./money.js";

/**
 * Loan lifecycle. Settled is final.
 */
export type LoanStatus =
  | "CONTRACTED"
  | "IN_PROGRESS"
  | "DELINQUENT"
  | "SETTLED";

/**
 * Allowed state transitions. Anything not listed here is rejected — including
 * Contracted → Settled, which must pass through In Progress.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<LoanStatus, readonly LoanStatus[]>
> = {
  CONTRACTED: ["IN_PROGRESS", "DELINQUENT"],
  IN_PROGRESS: ["SETTLED", "DELINQUENT"],
  DELINQUENT: ["IN_PROGRESS", "SETTLED"],
  SETTLED: [],
};

const LOAN_STATUSES: ReadonlySet<string> = new Set<LoanStatus>([
  "CONTRACTED",
  "IN_PROGRESS",
  "DELINQUENT",
  "SETTLED",
]);

/**
 * What the loan needs to know about the account it is paid from.
 */
export interface LoanAccount {
  id: string;
  companyId: string;
  currency: string;
  isActive: boolean;
}

/**
 * What the loan needs to know about its creditor, when there is one.
 */
export interface LoanCreditor {
  id: string;
  companyId: string;
}

export interface LoanProps {
  id: string;
  companyId: string;
  accountId: string;
  personId?: string | undefined;
  description: string;
  principalAmount: Money;
  monthlyInterestPercent: number;
  installmentCount: number;
  installmentAmount: Money;
  currency: string;
  firstDueDate: Date;
  status?: LoanStatus;
  settledAt?: Date | undefined;
  createdAt?: Date;
}

export interface ContractLoanInput {
  id?: string;
  companyId: string;
  account: LoanAccount;
  creditor?: LoanCreditor | undefined;
  description: string;
  principalAmount: number;
  monthlyInterestPercent: number;
  installmentCount: number;
  installmentAmount: number;
  firstDueDate: Date;
}

/**
 * Fields that may change after contracting. The financial terms are not among
 * them: changing them would invalidate the schedule already generated.
 */
export interface EditLoanInput {
  description?: string | undefined;
  personId?: string | null | undefined;
}

/**
 * The result of contracting: the loan plus the schedule to persist with it.
 */
export interface ContractLoanResult {
  loan: Loan;
  installments: LoanInstallment[];
}

/**
 * The derived figures of a loan. None of them is stored: the outstanding
 * balance is the principal minus everything already amortized, and recomputing
 * it is always the answer (the same discipline as the account balance, RN-02).
 */
export interface LoanBalance {
  outstandingBalance: Money;
  paidInstallments: number;
  remainingInstallments: number;
  interestPaid: Money;
}

/**
 * Loan aggregate root.
 *
 * Keeps the contract terms and the lifecycle status — status is real state,
 * because it depends on external events (a due date passing), exactly like
 * `Charge` and `Invoice`. The schedule is materialized at contract time because
 * an installment is an entity with its own identity and situation.
 */
export class Loan extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _accountId: string;
  private readonly _principalAmount: Money;
  private readonly _monthlyInterestPercent: number;
  private readonly _installmentCount: number;
  private readonly _installmentAmount: Money;
  private readonly _currency: string;
  private readonly _firstDueDate: Date;
  private _personId: string | undefined;
  private _description: string;
  private _status: LoanStatus;
  private _settledAt: Date | undefined;

  constructor(props: LoanProps) {
    super(props.id, props.createdAt);

    const description = props.description.trim();
    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Loan requires a company",
      );
    }

    if (description.length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Loan description is required",
      );
    }

    if (props.accountId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Loan requires a linked account",
      );
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    const status = props.status ?? "CONTRACTED";
    if (!LOAN_STATUSES.has(status)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid loan status: ${status}`,
      );
    }

    if (Number.isNaN(props.firstDueDate.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid first due date");
    }

    this._companyId = props.companyId;
    this._accountId = props.accountId;
    this._personId = props.personId;
    this._description = description;
    this._principalAmount = props.principalAmount;
    this._monthlyInterestPercent = props.monthlyInterestPercent;
    this._installmentCount = props.installmentCount;
    this._installmentAmount = props.installmentAmount;
    this._currency = currency;
    this._firstDueDate = toUtcDate(props.firstDueDate);
    this._status = status;
    this._settledAt = props.settledAt;
  }

  get companyId(): string {
    return this._companyId;
  }

  get accountId(): string {
    return this._accountId;
  }

  get personId(): string | undefined {
    return this._personId;
  }

  get description(): string {
    return this._description;
  }

  get principalAmount(): Money {
    return this._principalAmount;
  }

  get monthlyInterestPercent(): number {
    return this._monthlyInterestPercent;
  }

  get installmentCount(): number {
    return this._installmentCount;
  }

  get installmentAmount(): Money {
    return this._installmentAmount;
  }

  get currency(): string {
    return this._currency;
  }

  get firstDueDate(): Date {
    return new Date(this._firstDueDate.getTime());
  }

  get status(): LoanStatus {
    return this._status;
  }

  get settledAt(): Date | undefined {
    return this._settledAt;
  }

  get isSettled(): boolean {
    return this._status === "SETTLED";
  }

  private ensureCanTransitionTo(next: LoanStatus): DomainError | undefined {
    if (ALLOWED_TRANSITIONS[this._status].includes(next)) {
      return undefined;
    }

    if (this._status === "SETTLED") {
      return DomainError.create(
        "INVALID_OPERATION",
        "A settled loan cannot be reopened",
      );
    }

    if (this._status === "CONTRACTED" && next === "SETTLED") {
      return DomainError.create(
        "INVALID_OPERATION",
        "A contracted loan must go through 'in progress' before being settled",
      );
    }

    return DomainError.create(
      "INVALID_OPERATION",
      `Cannot transition loan from ${this._status} to ${next}`,
    );
  }

  /**
   * Contracted → In Progress, on the first payment.
   */
  start(): Result<Loan> {
    const error = this.ensureCanTransitionTo("IN_PROGRESS");
    if (error) {
      return Result.failed(error);
    }

    this._status = "IN_PROGRESS";
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Contracted or In Progress → Delinquent, when an installment falls overdue.
   */
  markDelinquent(): Result<Loan> {
    const error = this.ensureCanTransitionTo("DELINQUENT");
    if (error) {
      return Result.failed(error);
    }

    this._status = "DELINQUENT";
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Delinquent → In Progress, when no overdue installment remains. Not a
   * scheduler pass: regularization happens at the moment of payment.
   */
  regularize(): Result<Loan> {
    const error = this.ensureCanTransitionTo("IN_PROGRESS");
    if (error) {
      return Result.failed(error);
    }

    this._status = "IN_PROGRESS";
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * In Progress or Delinquent → Settled. Final.
   */
  settle(settledAt = new Date()): Result<Loan> {
    const error = this.ensureCanTransitionTo("SETTLED");
    if (error) {
      return Result.failed(error);
    }

    this._status = "SETTLED";
    this._settledAt = settledAt;
    this.setUpdatedAt();
    this.raiseEvent(
      new LoanSettled(
        this.id,
        this._companyId,
        settledAt,
        this._principalAmount,
      ),
    );

    return Result.success(this);
  }

  /**
   * Edits the descriptive fields. A settled loan is frozen.
   */
  edit(input: EditLoanInput): Result<Loan> {
    if (this.isSettled) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A settled loan cannot be edited",
        ),
      );
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (description.length === 0) {
        return Result.failed(
          DomainError.create(
            "VALIDATION_ERROR",
            "Loan description is required",
          ),
        );
      }
      this._description = description;
    }

    if (input.personId !== undefined) {
      this._personId = input.personId === null ? undefined : input.personId;
    }

    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Derives the outstanding balance and the counters from the schedule.
   *
   * The balance is the sum of the principal portions still open — equivalently,
   * the principal minus everything already amortized, which is how the rule
   * reads. Summing what is left rather than subtracting what was paid is what
   * keeps an extra amortization from being counted twice: an amortization
   * settles whole installments *and* reduces the principal portion of the one
   * it only partially covers, so both effects are already visible in the open
   * lines. Nothing here is stored.
   */
  balanceFrom(installments: readonly LoanInstallment[]): LoanBalance {
    const paid = installments.filter((installment) => installment.isPaid);
    const open = installments.filter((installment) => !installment.isPaid);

    const interestPaid = Money.sum(
      this._currency,
      paid.map((installment) => installment.interestAmount),
    );

    let outstandingBalance = Money.sum(
      this._currency,
      open.map((installment) => installment.principalAmount),
    );
    if (outstandingBalance.isNegative()) {
      outstandingBalance = Money.zero(this._currency);
    }

    return {
      outstandingBalance,
      paidInstallments: paid.length,
      remainingInstallments: open.length,
      interestPaid,
    };
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      accountId: this._accountId,
      personId: this._personId,
      description: this._description,
      principalAmount: this._principalAmount.amount,
      monthlyInterestPercent: this._monthlyInterestPercent,
      installmentCount: this._installmentCount,
      installmentAmount: this._installmentAmount.amount,
      currency: this._currency,
      firstDueDate: this._firstDueDate,
      status: this._status,
      settledAt: this._settledAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Contracts a loan and generates its full schedule.
   *
   * The loan currency is the account's: paying an installment from an account
   * in another currency is rejected anyway, so there is nothing else it could be.
   */
  static contract(input: ContractLoanInput): Result<ContractLoanResult> {
    const { account, creditor } = input;

    if (account.companyId !== input.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A loan can only be linked to an account of the same company",
        ),
      );
    }

    if (creditor && creditor.companyId !== input.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "The creditor must belong to the same company",
        ),
      );
    }

    if (
      !Number.isFinite(input.monthlyInterestPercent) ||
      input.monthlyInterestPercent < 0 ||
      input.monthlyInterestPercent > 100
    ) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The monthly interest rate must be between 0% and 100%",
        ),
      );
    }

    if (
      !Number.isInteger(input.installmentCount) ||
      input.installmentCount < 1
    ) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The number of installments must be greater than zero",
        ),
      );
    }

    const currency = normalizeCurrency(account.currency);

    let principalAmount: Money;
    let installmentAmount: Money;
    try {
      principalAmount = Money.create(input.principalAmount, currency);
      installmentAmount = Money.create(input.installmentAmount, currency);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    if (!principalAmount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The principal must be greater than zero",
        ),
      );
    }

    if (!installmentAmount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The installment amount must be greater than zero",
        ),
      );
    }

    // Without this, the schedule never zeroes the balance — better to reject the
    // contract than to generate a whole set of wrong installments.
    const scheduled = installmentAmount.multiply(input.installmentCount);
    if (scheduled.lessThan(principalAmount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "The schedule does not repay the principal: installments × amount is lower than the principal",
        ),
      );
    }

    let loan: Loan;
    try {
      loan = new Loan({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        accountId: account.id,
        personId: creditor?.id,
        description: input.description,
        principalAmount,
        monthlyInterestPercent: input.monthlyInterestPercent,
        installmentCount: input.installmentCount,
        installmentAmount,
        currency,
        firstDueDate: input.firstDueDate,
        status: "CONTRACTED",
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    const installments = buildSchedule({
      principal: principalAmount,
      monthlyRatePercent: input.monthlyInterestPercent,
      installmentCount: input.installmentCount,
      installmentAmount,
      firstDueDate: input.firstDueDate,
    }).map((line) =>
      LoanInstallment.create({
        companyId: loan.companyId,
        loanId: loan.id,
        number: line.number,
        dueDate: line.dueDate,
        amount: line.amount,
        interestAmount: line.interestAmount,
        principalAmount: line.principalAmount,
        status: "PENDING",
      }),
    );

    loan.raiseEvent(
      new LoanCreated(
        loan.id,
        loan.companyId,
        loan.accountId,
        loan.description,
        principalAmount,
        input.installmentCount,
        installmentAmount,
        input.monthlyInterestPercent,
        loan.firstDueDate,
        creditor?.id,
      ),
    );

    return Result.success({ loan, installments });
  }
}
