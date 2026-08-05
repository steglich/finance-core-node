import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import type { CategoryType } from "./category.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import {
  InvestmentClosed,
  InvestmentCreated,
} from "./investment-events.js";

/**
 * Kinds of asset the system knows how to hold.
 */
export type InvestmentType =
  | "STOCK"
  | "REIT"
  | "TREASURY"
  | "CD"
  | "CRYPTO"
  | "ETF"
  | "FUND"
  | "PENSION";

/**
 * Investment lifecycle. Closed is final and accepts no new operations.
 */
export type InvestmentStatus = "ACTIVE" | "CLOSED";

const INVESTMENT_TYPES: ReadonlySet<string> = new Set<InvestmentType>([
  "STOCK",
  "REIT",
  "TREASURY",
  "CD",
  "CRYPTO",
  "ETF",
  "FUND",
  "PENSION",
]);

const INVESTMENT_STATUSES: ReadonlySet<string> = new Set<InvestmentStatus>([
  "ACTIVE",
  "CLOSED",
]);

/**
 * What the investment needs to know about the account it settles through. The
 * aggregate cannot load it, so the caller — which did — supplies it.
 */
export interface InvestmentAccount {
  id: string;
  companyId: string;
  currency: string;
  isActive: boolean;
}

/**
 * What the investment needs to know about a category it classifies with.
 */
export interface InvestmentCategory {
  id: string;
  companyId: string;
  type: CategoryType;
}

/**
 * Constructor properties for rehydrating an investment from persistence.
 */
export interface InvestmentProps {
  id: string;
  companyId: string;
  accountId: string;
  name: string;
  investmentType: InvestmentType;
  symbol?: string | undefined;
  currency: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
  status?: InvestmentStatus;
  closedAt?: Date | undefined;
  createdAt?: Date;
}

/**
 * Input for registering a new investment.
 */
export interface CreateInvestmentInput {
  id?: string;
  companyId: string;
  account: InvestmentAccount;
  name: string;
  investmentType: string;
  symbol?: string | undefined;
  currency: string;
  expenseCategory: InvestmentCategory;
  incomeCategory: InvestmentCategory;
}

/**
 * Fields that may change after registration. Type, currency and account are
 * not among them: changing any of them would reinterpret every past operation.
 */
export interface EditInvestmentInput {
  name?: string | undefined;
  symbol?: string | null | undefined;
  expenseCategory?: InvestmentCategory | undefined;
  incomeCategory?: InvestmentCategory | undefined;
}

/**
 * Investment aggregate root.
 *
 * Holds identity and configuration only. Quantity, average cost, invested
 * amount and realized result are derived from the operations by
 * `investment-position.ts` and are never stored here — persisting them would
 * create a second source of truth that diverges on the first correction
 * (the same discipline as the account balance, RN-02).
 */
export class Investment extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _accountId: string;
  private readonly _investmentType: InvestmentType;
  private readonly _currency: string;
  private _name: string;
  private _symbol: string | undefined;
  private _expenseCategoryId: string;
  private _incomeCategoryId: string;
  private _status: InvestmentStatus;
  private _closedAt: Date | undefined;

  constructor(props: InvestmentProps) {
    super(props.id, props.createdAt);

    const name = props.name.trim();
    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Investment requires a company",
      );
    }

    if (name.length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Investment name is required",
      );
    }

    if (props.accountId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Investment requires a linked account",
      );
    }

    if (!INVESTMENT_TYPES.has(props.investmentType)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid investment type: ${props.investmentType}`,
      );
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    const status = props.status ?? "ACTIVE";
    if (!INVESTMENT_STATUSES.has(status)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid investment status: ${status}`,
      );
    }

    this._companyId = props.companyId;
    this._accountId = props.accountId;
    this._name = name;
    this._investmentType = props.investmentType;
    this._symbol = props.symbol?.trim() || undefined;
    this._currency = currency;
    this._expenseCategoryId = props.expenseCategoryId;
    this._incomeCategoryId = props.incomeCategoryId;
    this._status = status;
    this._closedAt = props.closedAt;
  }

  get companyId(): string {
    return this._companyId;
  }

  /**
   * The account every operation of this investment settles through. Immutable:
   * moving it would leave past transactions on the wrong account.
   */
  get accountId(): string {
    return this._accountId;
  }

  get name(): string {
    return this._name;
  }

  get investmentType(): InvestmentType {
    return this._investmentType;
  }

  get symbol(): string | undefined {
    return this._symbol;
  }

  get currency(): string {
    return this._currency;
  }

  get expenseCategoryId(): string {
    return this._expenseCategoryId;
  }

  get incomeCategoryId(): string {
    return this._incomeCategoryId;
  }

  get status(): InvestmentStatus {
    return this._status;
  }

  get closedAt(): Date | undefined {
    return this._closedAt;
  }

  get isActive(): boolean {
    return this._status === "ACTIVE";
  }

  /**
   * Validates a category against the type the investment needs it for and the
   * company it must belong to.
   */
  private static validateCategory(
    category: InvestmentCategory,
    companyId: string,
    expectedType: CategoryType,
  ): DomainError | undefined {
    if (category.companyId !== companyId) {
      return DomainError.create(
        "UNAUTHORIZED_ACCESS",
        "Investment categories must belong to the same company",
      );
    }
    if (category.type !== expectedType) {
      return DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Category ${category.id} is of type ${category.type}; a ${expectedType} category is required`,
      );
    }
    return undefined;
  }

  /**
   * Edits the mutable configuration. Currency, type and account stay fixed.
   */
  edit(input: EditInvestmentInput): Result<Investment> {
    if (!this.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A closed investment cannot be edited",
        ),
      );
    }

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0) {
        return Result.failed(
          DomainError.create(
            "VALIDATION_ERROR",
            "Investment name is required",
          ),
        );
      }
      this._name = name;
    }

    if (input.symbol !== undefined) {
      this._symbol = input.symbol === null ? undefined : input.symbol.trim() || undefined;
    }

    if (input.expenseCategory) {
      const error = Investment.validateCategory(
        input.expenseCategory,
        this._companyId,
        "EXPENSE",
      );
      if (error) {
        return Result.failed(error);
      }
      this._expenseCategoryId = input.expenseCategory.id;
    }

    if (input.incomeCategory) {
      const error = Investment.validateCategory(
        input.incomeCategory,
        this._companyId,
        "INCOME",
      );
      if (error) {
        return Result.failed(error);
      }
      this._incomeCategoryId = input.incomeCategory.id;
    }

    this.setUpdatedAt();

    return Result.success(this);
  }

  /**
   * Closes the investment. Only a zero position may be closed — an open
   * position would silently disappear from the portfolio.
   */
  close(positionQuantity: number, closedAt = new Date()): Result<Investment> {
    if (!this.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Investment is already closed",
        ),
      );
    }

    if (Math.abs(positionQuantity) > 1e-8) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Investment still holds a position of ${positionQuantity} and cannot be closed`,
        ),
      );
    }

    this._status = "CLOSED";
    this._closedAt = closedAt;
    this.setUpdatedAt();
    this.raiseEvent(new InvestmentClosed(this.id, this._companyId, closedAt));

    return Result.success(this);
  }

  /**
   * Guard used by the operation service: a closed investment accepts nothing.
   */
  ensureAcceptsOperations(): DomainError | undefined {
    if (!this.isActive) {
      return DomainError.create(
        "INVALID_OPERATION",
        `Investment ${this.id} is closed and does not accept new operations`,
      );
    }
    return undefined;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      accountId: this._accountId,
      name: this._name,
      investmentType: this._investmentType,
      symbol: this._symbol,
      currency: this._currency,
      expenseCategoryId: this._expenseCategoryId,
      incomeCategoryId: this._incomeCategoryId,
      status: this._status,
      closedAt: this._closedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Registers an investment, checking it against the account it settles through
   * and the two categories it classifies its money movements with.
   */
  static create(input: CreateInvestmentInput): Result<Investment> {
    const { account } = input;

    if (!INVESTMENT_TYPES.has(input.investmentType)) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          `Invalid investment type: ${input.investmentType}`,
        ),
      );
    }

    if (account.companyId !== input.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "An investment can only be linked to an account of the same company",
        ),
      );
    }

    if (!account.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An investment cannot be linked to an inactive account",
        ),
      );
    }

    const currency = normalizeCurrency(input.currency);
    if (normalizeCurrency(account.currency) !== currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Investment currency ${currency} does not match account currency ${account.currency}`,
        ),
      );
    }

    const expenseError = Investment.validateCategory(
      input.expenseCategory,
      input.companyId,
      "EXPENSE",
    );
    if (expenseError) {
      return Result.failed(expenseError);
    }

    const incomeError = Investment.validateCategory(
      input.incomeCategory,
      input.companyId,
      "INCOME",
    );
    if (incomeError) {
      return Result.failed(incomeError);
    }

    let investment: Investment;
    try {
      investment = new Investment({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        accountId: account.id,
        name: input.name,
        investmentType: input.investmentType as InvestmentType,
        symbol: input.symbol,
        currency,
        expenseCategoryId: input.expenseCategory.id,
        incomeCategoryId: input.incomeCategory.id,
        status: "ACTIVE",
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    investment.raiseEvent(
      new InvestmentCreated(
        investment.id,
        investment.companyId,
        investment.accountId,
        investment.name,
        investment.investmentType,
        investment.currency,
        investment.symbol,
      ),
    );

    return Result.success(investment);
  }
}
