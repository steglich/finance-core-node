import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import {
  BudgetCreated,
  BudgetExceeded,
  BudgetPeriodClosed,
} from "./budget-events.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { toUtcDate } from "./date-math.js";
import { Money } from "./money.js";
import { Period } from "./period.js";

/**
 * Budget lifecycle states.
 */
export type BudgetStatus = "ACTIVE" | "CLOSED" | "INACTIVE";

const BUDGET_STATUSES: ReadonlySet<string> = new Set<BudgetStatus>([
  "ACTIVE",
  "CLOSED",
  "INACTIVE",
]);

/**
 * The subset of a category a budget needs to validate itself.
 * `Category` satisfies it structurally.
 */
export interface BudgetCategory {
  id: string;
  companyId: string;
  type: "EXPENSE" | "INCOME";
}

/**
 * Derived view of how much of a budget has been used.
 *
 * `percentUsed` is a plain number rather than a `Percent`, because a budget can
 * legitimately go past 100% (106,25% in the spec) and `Percent` is capped at 100.
 */
export interface BudgetProgress {
  plannedAmount: Money;
  actualAmount: Money;
  remaining: Money;
  percentUsed: number;
  exceeded: boolean;
}

/**
 * Constructor properties for rehydrating a budget from persistence.
 */
export interface BudgetProps {
  id: string;
  companyId: string;
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  period: Period;
  plannedAmount: Money;
  currency: string;
  status?: BudgetStatus;
  exceededNotified?: boolean;
  actualAmount?: Money | undefined;
  closedAt?: Date | undefined;
  createdAt?: Date;
}

/**
 * Input for creating a budget.
 */
export interface CreateBudgetInput {
  id?: string;
  companyId: string;
  category?: BudgetCategory | undefined;
  costCenterId?: string | undefined;
  periodStart: Date;
  periodEnd: Date;
  plannedAmount: number;
  currency: string;
}

/**
 * Fields that may be changed while the period is open.
 *
 * The dimensions are deliberately absent: moving a budget to another category
 * or cost center would silently rewrite what it was measuring, and the figures
 * already reported against it would stop meaning anything.
 */
export interface EditBudgetInput {
  plannedAmount?: number | undefined;
}

/**
 * Budget aggregate root.
 *
 * The amount actually spent is never stored while the period is open: it comes
 * from the confirmed expenses of the category and its descendants, exactly like
 * the account balance and the card's available limit (RN-02). Only the fact that
 * an alert has already fired is persisted, because that is what prevents a new
 * alert on every additional transaction.
 */
export class Budget extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _categoryId: string | undefined;
  private readonly _costCenterId: string | undefined;
  private readonly _period: Period;
  private readonly _currency: string;
  private _plannedAmount: Money;
  private _status: BudgetStatus;
  private _exceededNotified: boolean;
  private _actualAmount: Money | undefined;
  private _closedAt: Date | undefined;

  constructor(props: BudgetProps) {
    super(props.id, props.createdAt);

    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Budget requires a company",
      );
    }

    const categoryId = props.categoryId?.trim() || undefined;
    const costCenterId = props.costCenterId?.trim() || undefined;

    // A budget measures spending along at least one dimension; with neither it
    // would be measuring the whole company, which is not what a budget is.
    if (!categoryId && !costCenterId) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Budget requires a category, a cost center, or both",
      );
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    const status = props.status ?? "ACTIVE";
    if (!BUDGET_STATUSES.has(status)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid budget status: ${status}`,
      );
    }

    if (props.plannedAmount.currency !== currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Planned amount currency ${props.plannedAmount.currency} does not match ${currency}`,
      );
    }

    if (!props.plannedAmount.isPositive()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "The planned amount must be greater than zero",
      );
    }

    this._companyId = props.companyId;
    this._categoryId = categoryId;
    this._costCenterId = costCenterId;
    this._period = props.period;
    this._currency = currency;
    this._plannedAmount = props.plannedAmount;
    this._status = status;
    this._exceededNotified = props.exceededNotified ?? false;
    this._actualAmount = props.actualAmount;
    this._closedAt = props.closedAt;
  }

  get companyId(): string {
    return this._companyId;
  }

  /**
   * Category dimension, when the budget has one.
   */
  get categoryId(): string | undefined {
    return this._categoryId;
  }

  /**
   * Cost center dimension, when the budget has one.
   */
  get costCenterId(): string | undefined {
    return this._costCenterId;
  }

  get period(): Period {
    return this._period;
  }

  get plannedAmount(): Money {
    return this._plannedAmount;
  }

  get currency(): string {
    return this._currency;
  }

  get status(): BudgetStatus {
    return this._status;
  }

  get exceededNotified(): boolean {
    return this._exceededNotified;
  }

  /**
   * Frozen amount, set only when the period closes. While the period is open the
   * actual amount is derived on demand.
   */
  get frozenActualAmount(): Money | undefined {
    return this._actualAmount;
  }

  get closedAt(): Date | undefined {
    return this._closedAt;
  }

  get isActive(): boolean {
    return this._status === "ACTIVE";
  }

  get isClosed(): boolean {
    return this._status === "CLOSED";
  }

  private assertSameCurrency(actual: Money): DomainError | undefined {
    return actual.currency === this._currency
      ? undefined
      : DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Actual amount currency ${actual.currency} does not match budget currency ${this._currency}`,
        );
  }

  /**
   * Spent, remaining and percentage used for a given actual amount.
   */
  progress(actual: Money): Result<BudgetProgress> {
    const error = this.assertSameCurrency(actual);
    if (error) {
      return Result.failed(error);
    }

    const percentUsed =
      this._plannedAmount.cents === 0
        ? 0
        : (actual.cents / this._plannedAmount.cents) * 100;

    return Result.success({
      plannedAmount: this._plannedAmount,
      actualAmount: actual,
      remaining: this._plannedAmount.subtract(actual),
      percentUsed,
      exceeded: actual.greaterThan(this._plannedAmount),
    });
  }

  /**
   * Compares the actual amount against the plan and decides whether the alert
   * fires. The flag is what makes the alert happen once per overrun: it is only
   * rearmed when spending drops back below 100%.
   */
  evaluate(actual: Money): Result<BudgetProgress> {
    if (!this.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A ${this._status} budget is not evaluated`,
        ),
      );
    }

    const progress = this.progress(actual);
    if (progress.isFailure || !progress.value) {
      return progress;
    }

    if (progress.value.exceeded && !this._exceededNotified) {
      this._exceededNotified = true;
      this.setUpdatedAt();
      this.raiseEvent(
        new BudgetExceeded(
          this.id,
          this._companyId,
          this._categoryId,
          this._period,
          this._plannedAmount,
          actual,
          progress.value.percentUsed,
        ),
      );
    } else if (!progress.value.exceeded && this._exceededNotified) {
      // Back under the limit: the alert is rearmed for the next overrun.
      this._exceededNotified = false;
      this.setUpdatedAt();
    }

    return progress;
  }

  /**
   * Freezes the actual amount once the period has ended. A closed period cannot
   * be reopened or edited.
   */
  closePeriod(actual: Money, referenceDate: Date = new Date()): Result<Budget> {
    if (this._status !== "ACTIVE") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A ${this._status} budget period cannot be closed`,
        ),
      );
    }

    const error = this.assertSameCurrency(actual);
    if (error) {
      return Result.failed(error);
    }

    if (toUtcDate(referenceDate).getTime() <= this._period.endDate.getTime()) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "The budget period has not ended yet",
        ),
      );
    }

    this._actualAmount = actual;
    this._status = "CLOSED";
    this._closedAt = new Date();
    this.setUpdatedAt();

    this.raiseEvent(
      new BudgetPeriodClosed(
        this.id,
        this._companyId,
        this._categoryId,
        this._period,
        this._plannedAmount,
        actual,
        this._plannedAmount.subtract(actual),
      ),
    );

    return Result.success(this);
  }

  /**
   * Edits the planned amount. Blocked once the period is closed.
   */
  edit(input: EditBudgetInput): Result<Budget> {
    if (this._status === "CLOSED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A budget with a closed period cannot be edited",
        ),
      );
    }

    if (input.plannedAmount === undefined) {
      return Result.failed(
        DomainError.create("VALIDATION_ERROR", "Nothing to update"),
      );
    }

    let plannedAmount: Money;
    try {
      plannedAmount = Money.create(input.plannedAmount, this._currency);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    if (!plannedAmount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The planned amount must be greater than zero",
        ),
      );
    }

    this._plannedAmount = plannedAmount;
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Stops counting new transactions toward the budget. The record is preserved.
   */
  deactivate(): Result<Budget> {
    if (this._status !== "ACTIVE") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A ${this._status} budget cannot be deactivated`,
        ),
      );
    }

    this._status = "INACTIVE";
    this.setUpdatedAt();

    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      categoryId: this._categoryId,
      costCenterId: this._costCenterId,
      periodStart: this._period.startDate,
      periodEnd: this._period.endDate,
      plannedAmount: this._plannedAmount.amount,
      currency: this._currency,
      status: this._status,
      exceededNotified: this._exceededNotified,
      actualAmount: this._actualAmount?.amount,
      closedAt: this._closedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a budget for an expense category of the same company.
   */
  static create(input: CreateBudgetInput): Result<Budget> {
    try {
      const { category, costCenterId } = input;

      if (!category && !costCenterId) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "Budget requires a category, a cost center, or both",
        );
      }

      if (category) {
        if (category.id.trim().length === 0) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Budget requires a valid category",
          );
        }

        if (category.companyId !== input.companyId) {
          throw DomainError.create(
            "UNAUTHORIZED_ACCESS",
            "A budget can only target a category of the same company",
          );
        }

        if (category.type !== "EXPENSE") {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "A budget can only be created for an expense category",
          );
        }
      }

      const period = Period.create(
        toUtcDate(input.periodStart),
        toUtcDate(input.periodEnd),
      );

      const budget = new Budget({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        categoryId: category?.id,
        costCenterId,
        period,
        plannedAmount: Money.create(input.plannedAmount, input.currency),
        currency: input.currency,
      });

      budget.raiseEvent(
        new BudgetCreated(
          budget.id,
          budget.companyId,
          budget.categoryId,
          budget.costCenterId,
          period,
          budget.plannedAmount,
        ),
      );

      return Result.success(budget);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
