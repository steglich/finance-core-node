import { randomUUID } from "node:crypto";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { toUtcDate } from "./date-math.js";
import { Money } from "./money.js";

/**
 * What an operation does to the position and to the linked account.
 * BUY is the only one that takes money out; the rest bring money in.
 */
export type OperationType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "INTEREST"
  | "AMORTIZATION";

const OPERATION_TYPES: ReadonlySet<string> = new Set<OperationType>([
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "AMORTIZATION",
]);

/**
 * Operations that carry a quantity and a unit price; the others are income
 * events on a position that the operation itself does not change.
 */
const QUANTITY_BEARING: ReadonlySet<string> = new Set<OperationType>([
  "BUY",
  "SELL",
]);

export function isQuantityBearing(type: OperationType): boolean {
  return QUANTITY_BEARING.has(type);
}

/**
 * Whether the operation debits (BUY) or credits the linked account.
 */
export function operationDirection(type: OperationType): "CREDIT" | "DEBIT" {
  return type === "BUY" ? "DEBIT" : "CREDIT";
}

/**
 * Constructor properties for rehydrating an operation from persistence.
 */
export interface InvestmentOperationProps {
  id: string;
  companyId: string;
  investmentId: string;
  transactionId?: string | undefined;
  operationType: OperationType;
  quantity: number;
  unitPrice: number;
  fees: Money;
  amount: Money;
  currency: string;
  operatedAt: Date;
  notes?: string | undefined;
  createdAt?: Date;
}

/**
 * Input for registering a new operation.
 */
export interface CreateInvestmentOperationInput {
  id?: string;
  companyId: string;
  investmentId: string;
  operationType: string;
  quantity?: number | undefined;
  unitPrice?: number | undefined;
  fees?: number | undefined;
  /** Only used by the income operations, which carry no quantity. */
  amount?: number | undefined;
  currency: string;
  operatedAt: Date;
  notes?: string | undefined;
  /** Today, so a future-dated operation can be rejected. Injectable for tests. */
  today?: Date | undefined;
}

/**
 * An operation on an investment.
 *
 * An entity, not an aggregate root: it only exists inside an investment, and it
 * is the raw material the position derivation consumes.
 */
export class InvestmentOperation extends Entity<string> {
  private readonly _companyId: string;
  private readonly _investmentId: string;
  private _transactionId: string | undefined;
  private readonly _operationType: OperationType;
  private readonly _quantity: number;
  private readonly _unitPrice: number;
  private readonly _fees: Money;
  private readonly _amount: Money;
  private readonly _currency: string;
  private readonly _operatedAt: Date;
  private readonly _notes: string | undefined;

  constructor(props: InvestmentOperationProps) {
    super(props.id, props.createdAt);

    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Investment operation requires a company",
      );
    }

    if (!OPERATION_TYPES.has(props.operationType)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid operation type: ${props.operationType}`,
      );
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    if (Number.isNaN(props.operatedAt.getTime())) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid operation date");
    }

    this._companyId = props.companyId;
    this._investmentId = props.investmentId;
    this._transactionId = props.transactionId;
    this._operationType = props.operationType;
    this._quantity = props.quantity;
    this._unitPrice = props.unitPrice;
    this._fees = props.fees;
    this._amount = props.amount;
    this._currency = currency;
    this._operatedAt = toUtcDate(props.operatedAt);
    this._notes = props.notes?.trim() || undefined;
  }

  get companyId(): string {
    return this._companyId;
  }

  get investmentId(): string {
    return this._investmentId;
  }

  /**
   * The transaction this operation produced on the linked account. Set once,
   * when the operation and its transaction are written together.
   */
  get transactionId(): string | undefined {
    return this._transactionId;
  }

  get operationType(): OperationType {
    return this._operationType;
  }

  get quantity(): number {
    return this._quantity;
  }

  get unitPrice(): number {
    return this._unitPrice;
  }

  get fees(): Money {
    return this._fees;
  }

  /**
   * The amount that moves the account: quantity × unit price + fees for a BUY
   * and a SELL, the informed amount for the income operations.
   */
  get amount(): Money {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  get operatedAt(): Date {
    return new Date(this._operatedAt.getTime());
  }

  get notes(): string | undefined {
    return this._notes;
  }

  get direction(): "CREDIT" | "DEBIT" {
    return operationDirection(this._operationType);
  }

  linkToTransaction(transactionId: string): void {
    this._transactionId = transactionId;
    this.setUpdatedAt();
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      investmentId: this._investmentId,
      transactionId: this._transactionId,
      operationType: this._operationType,
      quantity: this._quantity,
      unitPrice: this._unitPrice,
      fees: this._fees.amount,
      amount: this._amount.amount,
      currency: this._currency,
      operatedAt: this._operatedAt,
      notes: this._notes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Registers an operation, deriving the amount of a BUY or a SELL from the
   * quantity, the unit price and the fees rather than trusting an informed one.
   */
  static create(
    input: CreateInvestmentOperationInput,
  ): Result<InvestmentOperation> {
    if (!OPERATION_TYPES.has(input.operationType)) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          `Invalid operation type: ${input.operationType}`,
        ),
      );
    }

    const operationType = input.operationType as OperationType;
    const currency = normalizeCurrency(input.currency);

    if (Number.isNaN(input.operatedAt.getTime())) {
      return Result.failed(
        DomainError.create("VALIDATION_ERROR", "Invalid operation date"),
      );
    }

    const operatedAt = toUtcDate(input.operatedAt);
    const today = toUtcDate(input.today ?? new Date());
    if (operatedAt.getTime() > today.getTime()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "An investment operation cannot be dated in the future",
        ),
      );
    }

    try {
      const fees = Money.create(input.fees ?? 0, currency);
      if (fees.isNegative()) {
        return Result.failed(
          DomainError.create(
            "VALIDATION_ERROR",
            "Operation fees cannot be negative",
          ),
        );
      }

      let quantity = 0;
      let unitPrice = 0;
      let amount: Money;

      if (isQuantityBearing(operationType)) {
        quantity = input.quantity ?? 0;
        unitPrice = input.unitPrice ?? 0;

        if (!Number.isFinite(quantity) || quantity <= 0) {
          return Result.failed(
            DomainError.create(
              "VALIDATION_ERROR",
              `A ${operationType} operation requires a quantity greater than zero`,
            ),
          );
        }

        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          return Result.failed(
            DomainError.create(
              "VALIDATION_ERROR",
              `A ${operationType} operation requires a unit price greater than zero`,
            ),
          );
        }

        // The amount is derived, never informed: it is what actually leaves or
        // enters the account, fees included.
        amount = Money.fromCents(quantity * unitPrice * 100, currency).add(fees);
      } else {
        const informed = input.amount ?? 0;
        amount = Money.create(informed, currency);
      }

      if (!amount.isPositive()) {
        return Result.failed(
          DomainError.create(
            "VALIDATION_ERROR",
            "The operation amount must be greater than zero",
          ),
        );
      }

      const operation = new InvestmentOperation({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        investmentId: input.investmentId,
        operationType,
        quantity,
        unitPrice,
        fees,
        amount,
        currency,
        operatedAt,
        notes: input.notes,
      });

      return Result.success(operation);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
