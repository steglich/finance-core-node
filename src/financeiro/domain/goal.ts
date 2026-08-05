import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { toUtcDate } from "./date-math.js";
import {
  ContributionMade,
  GoalAchieved,
  GoalCreated,
} from "./goal-events.js";
import { Money } from "./money.js";
import { Percent } from "./percent.js";

/**
 * Goal lifecycle states.
 */
export type GoalStatus = "CREATED" | "IN_PROGRESS" | "ACHIEVED" | "CANCELLED";

/**
 * Allowed state transitions. Achieved and cancelled are terminal.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<GoalStatus, readonly GoalStatus[]>
> = {
  CREATED: ["IN_PROGRESS", "ACHIEVED", "CANCELLED"],
  IN_PROGRESS: ["ACHIEVED", "CANCELLED"],
  ACHIEVED: [],
  CANCELLED: [],
};

const GOAL_STATUSES: ReadonlySet<string> = new Set<GoalStatus>([
  "CREATED",
  "IN_PROGRESS",
  "ACHIEVED",
  "CANCELLED",
]);

/**
 * The subset of an account a goal needs to validate its binding.
 * `Account` satisfies it structurally.
 */
export interface GoalAccount {
  id: string;
  companyId: string;
  currency: string;
  isActive: boolean;
}

/**
 * Constructor properties for rehydrating a contribution from persistence.
 */
export interface GoalContributionProps {
  id: string;
  goalId: string;
  amount: Money;
  contributedAt: Date;
  transactionId?: string | undefined;
  createdAt?: Date;
}

/**
 * Child entity of the Goal aggregate. A contribution has no life of its own —
 * it is neither paid nor due individually, unlike an installment.
 */
export class GoalContribution extends Entity<string> {
  private readonly _goalId: string;
  private readonly _amount: Money;
  private readonly _contributedAt: Date;
  private readonly _transactionId: string | undefined;

  constructor(props: GoalContributionProps) {
    super(props.id, props.createdAt);

    if (!props.amount.isPositive()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "A contribution amount must be greater than zero",
      );
    }

    this._goalId = props.goalId;
    this._amount = props.amount;
    this._contributedAt = new Date(props.contributedAt.getTime());
    this._transactionId = props.transactionId;
  }

  get goalId(): string {
    return this._goalId;
  }

  get amount(): Money {
    return this._amount;
  }

  get contributedAt(): Date {
    return new Date(this._contributedAt.getTime());
  }

  get transactionId(): string | undefined {
    return this._transactionId;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      goalId: this._goalId,
      amount: this._amount.amount,
      currency: this._amount.currency,
      contributedAt: this._contributedAt,
      transactionId: this._transactionId,
      createdAt: this.createdAt,
    };
  }
}

/**
 * Constructor properties for rehydrating a goal from persistence.
 */
export interface GoalProps {
  id: string;
  companyId: string;
  accountId: string;
  name: string;
  targetAmount: Money;
  currentAmount?: Money;
  currency: string;
  deadline: Date;
  status?: GoalStatus;
  achievedAt?: Date | undefined;
  contributionCount?: number;
  createdAt?: Date;
}

/**
 * Input for creating a goal.
 */
export interface CreateGoalInput {
  id?: string;
  companyId: string;
  account: GoalAccount;
  name: string;
  targetAmount: number;
  deadline: Date;
  /** Defaults to today; injectable so the deadline check is testable. */
  referenceDate?: Date;
}

/**
 * Fields that may be changed while the goal is neither achieved nor cancelled.
 */
export interface EditGoalInput {
  name?: string | undefined;
  targetAmount?: number | undefined;
  deadline?: Date | undefined;
}

/**
 * Goal aggregate root.
 *
 * `currentAmount` is a cache reconcilable from the sum of the contributions,
 * the same discipline the account balance follows (RN-02).
 */
export class Goal extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _accountId: string;
  private readonly _currency: string;
  private _name: string;
  private _targetAmount: Money;
  private _currentAmount: Money;
  private _deadline: Date;
  private _status: GoalStatus;
  private _achievedAt: Date | undefined;
  private _contributionCount: number;

  constructor(props: GoalProps) {
    super(props.id, props.createdAt);

    const name = props.name.trim();
    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Goal requires a company",
      );
    }

    if (props.accountId.trim().length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Goal requires an account");
    }

    if (name.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Goal name is required");
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    const status = props.status ?? "CREATED";
    if (!GOAL_STATUSES.has(status)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid goal status: ${status}`,
      );
    }

    if (Number.isNaN(props.deadline.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid goal deadline");
    }

    if (props.targetAmount.currency !== currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Target amount currency ${props.targetAmount.currency} does not match ${currency}`,
      );
    }

    if (!props.targetAmount.isPositive()) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "The target amount must be greater than zero",
      );
    }

    const currentAmount = props.currentAmount ?? Money.zero(currency);
    if (currentAmount.currency !== currency) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Current amount currency ${currentAmount.currency} does not match ${currency}`,
      );
    }

    this._companyId = props.companyId;
    this._accountId = props.accountId;
    this._name = name;
    this._targetAmount = props.targetAmount;
    this._currentAmount = currentAmount;
    this._currency = currency;
    this._deadline = toUtcDate(props.deadline);
    this._status = status;
    this._achievedAt = props.achievedAt;
    this._contributionCount = props.contributionCount ?? 0;
  }

  get companyId(): string {
    return this._companyId;
  }

  get accountId(): string {
    return this._accountId;
  }

  get name(): string {
    return this._name;
  }

  get targetAmount(): Money {
    return this._targetAmount;
  }

  get currentAmount(): Money {
    return this._currentAmount;
  }

  get currency(): string {
    return this._currency;
  }

  get deadline(): Date {
    return new Date(this._deadline.getTime());
  }

  get status(): GoalStatus {
    return this._status;
  }

  get achievedAt(): Date | undefined {
    return this._achievedAt;
  }

  get contributionCount(): number {
    return this._contributionCount;
  }

  get isOpen(): boolean {
    return this._status === "CREATED" || this._status === "IN_PROGRESS";
  }

  /**
   * How far the contributions have taken the goal. Capped at 100% because a
   * contribution can never push the current amount past the target.
   */
  progress(): Percent {
    if (this._targetAmount.cents === 0) {
      return Percent.zero();
    }

    const ratio = this._currentAmount.cents / this._targetAmount.cents;
    return Percent.fromFraction(Math.min(Math.max(ratio, 0), 1));
  }

  private ensureCanTransitionTo(next: GoalStatus): DomainError | undefined {
    if (ALLOWED_TRANSITIONS[this._status].includes(next)) {
      return undefined;
    }

    return DomainError.create(
      "INVALID_OPERATION",
      `Cannot transition goal from ${this._status} to ${next}`,
    );
  }

  /**
   * Registers a contribution, moving the goal forward and settling it when the
   * target is reached. Overshooting the target is rejected, not truncated.
   */
  contribute(
    amount: Money,
    contributedAt: Date = new Date(),
    contributionId: string = randomUUID(),
  ): Result<GoalContribution> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A ${this._status} goal does not accept contributions`,
        ),
      );
    }

    if (amount.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Contribution currency ${amount.currency} does not match goal currency ${this._currency}`,
        ),
      );
    }

    if (!amount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The contribution amount must be greater than zero",
        ),
      );
    }

    const next = this._currentAmount.add(amount);
    if (next.greaterThan(this._targetAmount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `A contribution of ${amount.toDecimalString()} would take the goal past its target of ${this._targetAmount.toDecimalString()}`,
        ),
      );
    }

    const achieved = next.equals(this._targetAmount);
    const target: GoalStatus = achieved ? "ACHIEVED" : "IN_PROGRESS";

    const error = this.ensureCanTransitionTo(target);
    if (error) {
      return Result.failed(error);
    }

    let contribution: GoalContribution;
    try {
      contribution = new GoalContribution({
        id: contributionId,
        goalId: this.id,
        amount,
        contributedAt,
      });
    } catch (thrown) {
      if (thrown instanceof DomainError) {
        return Result.failed(thrown);
      }
      throw thrown;
    }

    this._currentAmount = next;
    this._contributionCount += 1;
    this._status = target;
    this.setUpdatedAt();

    this.raiseEvent(
      new ContributionMade(
        this.id,
        this._companyId,
        contribution.id,
        amount,
        this._currentAmount,
        this.progress().value,
        contributedAt,
      ),
    );

    if (achieved) {
      this._achievedAt = contributedAt;
      this.raiseEvent(
        new GoalAchieved(
          this.id,
          this._companyId,
          contributedAt,
          this._contributionCount,
          this._currentAmount,
        ),
      );
    }

    return Result.success(contribution);
  }

  /**
   * Cancels a goal that has not been achieved. Cancelled goals stop accepting
   * contributions and are never reopened.
   */
  cancel(): Result<Goal> {
    const error = this.ensureCanTransitionTo("CANCELLED");
    if (error) {
      return Result.failed(error);
    }

    this._status = "CANCELLED";
    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Edits name, target amount and deadline while the goal is still open.
   */
  edit(input: EditGoalInput): Result<Goal> {
    if (!this.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `A ${this._status} goal cannot be edited`,
        ),
      );
    }

    try {
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length === 0) {
          throw DomainError.create("VALIDATION_ERROR", "Goal name is required");
        }
        this._name = name;
      }

      if (input.targetAmount !== undefined) {
        const target = Money.create(input.targetAmount, this._currency);
        if (!target.isPositive()) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "The target amount must be greater than zero",
          );
        }
        if (target.lessThan(this._currentAmount)) {
          throw DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "The target amount cannot be lower than what has already been contributed",
          );
        }
        this._targetAmount = target;
      }

      if (input.deadline !== undefined) {
        if (Number.isNaN(input.deadline.getTime())) {
          throw DomainError.create("VALIDATION_ERROR", "Invalid goal deadline");
        }
        this._deadline = toUtcDate(input.deadline);
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

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      accountId: this._accountId,
      name: this._name,
      targetAmount: this._targetAmount.amount,
      currentAmount: this._currentAmount.amount,
      currency: this._currency,
      deadline: this.deadline,
      status: this._status,
      progress: this.progress().value,
      contributionCount: this._contributionCount,
      achievedAt: this._achievedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a goal bound to an active account of the same company, in that
   * account's currency.
   */
  static create(input: CreateGoalInput): Result<Goal> {
    try {
      const { account } = input;

      if (!account || account.id.trim().length === 0) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "Goal requires a linked account",
        );
      }

      if (account.companyId !== input.companyId) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A goal can only be bound to an account of the same company",
        );
      }

      if (!account.isActive) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "A goal cannot be bound to an inactive account",
        );
      }

      const today = toUtcDate(input.referenceDate ?? new Date());
      const deadline = toUtcDate(input.deadline);

      if (Number.isNaN(deadline.getTime())) {
        throw DomainError.create("VALIDATION_ERROR", "Invalid goal deadline");
      }

      if (deadline.getTime() < today.getTime()) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "The goal deadline must not be in the past",
        );
      }

      const currency = normalizeCurrency(account.currency);

      const goal = new Goal({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        accountId: account.id,
        name: input.name,
        targetAmount: Money.create(input.targetAmount, currency),
        currency,
        deadline,
      });

      goal.raiseEvent(
        new GoalCreated(
          goal.id,
          goal.companyId,
          goal.accountId,
          goal.name,
          goal.targetAmount,
          goal.deadline,
        ),
      );

      return Result.success(goal);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
