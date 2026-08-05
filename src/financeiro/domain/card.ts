import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { CardCreated, CardDeactivated, CardLimitChanged } from "./card-events.js";
import { Money } from "./money.js";

/**
 * Card type enumeration.
 */
export type CardType = "CREDIT" | "DEBIT" | "PREPAID";

const CARD_TYPES: ReadonlySet<string> = new Set<CardType>([
  "CREDIT",
  "DEBIT",
  "PREPAID",
]);

/**
 * The subset of an account a card needs to validate its binding.
 * `Account` satisfies it structurally.
 */
export interface CardAccount {
  id: string;
  companyId: string;
  currency: string;
  isActive: boolean;
}

/**
 * Constructor properties for rehydrating a card from persistence.
 */
export interface CardProps {
  id: string;
  companyId: string;
  accountId: string;
  name: string;
  type: CardType;
  brand: string;
  bank?: string | undefined;
  limit?: Money | undefined;
  closingDay?: number | undefined;
  dueDay?: number | undefined;
  currency: string;
  isActive?: boolean;
  createdAt?: Date;
}

/**
 * Input for creating a new card.
 */
export interface CreateCardInput {
  id?: string;
  companyId: string;
  account: CardAccount;
  name: string;
  type: CardType;
  brand: string;
  bank?: string | undefined;
  limit?: number | undefined;
  closingDay?: number | undefined;
  dueDay?: number | undefined;
}

/**
 * Mutable fields of a card. Type and account are immutable by design.
 */
export interface EditCardInput {
  name?: string | undefined;
  brand?: string | undefined;
  bank?: string | undefined;
  limit?: number | undefined;
  closingDay?: number | undefined;
  dueDay?: number | undefined;
}

function isCycleDay(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 31
  );
}

/**
 * Card entity of the Account aggregate, kept as an AggregateRoot for the event
 * machinery (same compromise as `Installment`).
 *
 * The available limit is never persisted: it is derived from the amount already
 * committed on the card, exactly as the account balance is derived from its
 * confirmed transactions (RN-02).
 */
export class Card extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _accountId: string;
  private readonly _type: CardType;
  private readonly _currency: string;
  private _name: string;
  private _brand: string;
  private _bank: string | undefined;
  private _limit: Money | undefined;
  private _closingDay: number | undefined;
  private _dueDay: number | undefined;
  private _isActive: boolean;

  constructor(props: CardProps) {
    super(props.id, props.createdAt);

    const name = props.name.trim();
    const brand = props.brand.trim();
    const currency = normalizeCurrency(props.currency);

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Card requires a company",
      );
    }

    // A card only exists bound to an account.
    if (props.accountId.trim().length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Card requires an account");
    }

    if (name.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Card name is required");
    }

    if (brand.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Card brand is required");
    }

    if (!CARD_TYPES.has(props.type)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid card type: ${props.type}`,
      );
    }

    if (!isSupportedCurrency(currency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${props.currency}`,
      );
    }

    if (props.type !== "DEBIT") {
      if (!props.limit || !props.limit.isPositive()) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          `A ${props.type} card requires a limit greater than zero`,
        );
      }
      if (props.limit.currency !== currency) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Card limit currency ${props.limit.currency} does not match ${currency}`,
        );
      }
    }

    if (props.type === "CREDIT") {
      if (!isCycleDay(props.closingDay)) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "A credit card requires a closing day between 1 and 31",
        );
      }
      if (!isCycleDay(props.dueDay)) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "A credit card requires a due day between 1 and 31",
        );
      }
    }

    this._companyId = props.companyId;
    this._accountId = props.accountId;
    this._name = name;
    this._type = props.type;
    this._brand = brand;
    this._bank = props.bank?.trim() || undefined;
    this._limit = props.type === "DEBIT" ? undefined : props.limit;
    this._closingDay = props.closingDay;
    this._dueDay = props.dueDay;
    this._currency = currency;
    this._isActive = props.isActive ?? true;
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

  /**
   * Immutable after creation.
   */
  get type(): CardType {
    return this._type;
  }

  get brand(): string {
    return this._brand;
  }

  get bank(): string | undefined {
    return this._bank;
  }

  get limit(): Money | undefined {
    return this._limit;
  }

  get closingDay(): number | undefined {
    return this._closingDay;
  }

  get dueDay(): number | undefined {
    return this._dueDay;
  }

  get currency(): string {
    return this._currency;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Whether purchases on this card are consolidated into invoices.
   */
  get isCredit(): boolean {
    return this._type === "CREDIT";
  }

  /**
   * Limit minus the amount already committed (unbilled purchases plus the
   * outstanding balance of unpaid invoices). Debit cards have no limit at all.
   */
  availableLimit(committed: Money): Result<Money> {
    const limit = this._limit;
    if (!limit) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A DEBIT card does not expose an available limit",
        ),
      );
    }

    if (committed.currency !== this._currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Committed amount currency ${committed.currency} does not match card currency ${this._currency}`,
        ),
      );
    }

    return Result.success(limit.subtract(committed));
  }

  /**
   * Whether a purchase of `amount` still fits in the available limit.
   */
  canAfford(amount: Money, committed: Money): Result<boolean> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Inactive cards do not accept new purchases",
        ),
      );
    }

    // A debit card is bounded by the account balance, not by a card limit.
    if (this._type === "DEBIT") {
      return Result.success(true);
    }

    const available = this.availableLimit(committed);
    if (available.isFailure || !available.value) {
      return Result.failed(
        available.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not compute the available limit",
          ),
      );
    }

    if (amount.greaterThan(available.value)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Purchase of ${amount.toDecimalString()} exceeds the available limit of ${available.value.toDecimalString()}`,
        ),
      );
    }

    return Result.success(true);
  }

  /**
   * Edits the mutable fields. A limit reduction below the committed amount is
   * rejected; a closing day change only takes effect on the next cycle, since
   * open invoices carry their own materialized dates.
   */
  edit(input: EditCardInput, committed?: Money): Result<Card> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create("INVALID_OPERATION", "Inactive cards cannot be edited"),
      );
    }

    let nextLimit: Money | undefined;

    try {
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length === 0) {
          throw DomainError.create("VALIDATION_ERROR", "Card name is required");
        }
        this._name = name;
      }

      if (input.brand !== undefined) {
        const brand = input.brand.trim();
        if (brand.length === 0) {
          throw DomainError.create("VALIDATION_ERROR", "Card brand is required");
        }
        this._brand = brand;
      }

      if (input.bank !== undefined) {
        this._bank = input.bank.trim() || undefined;
      }

      if (input.limit !== undefined) {
        if (this._type === "DEBIT") {
          throw DomainError.create(
            "INVALID_OPERATION",
            "A DEBIT card has no limit to change",
          );
        }

        const limit = Money.create(input.limit, this._currency);
        if (!limit.isPositive()) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Card limit must be greater than zero",
          );
        }
        if (committed && limit.lessThan(committed)) {
          throw DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            `The new limit ${limit.toDecimalString()} is lower than the committed amount ${committed.toDecimalString()}`,
          );
        }
        nextLimit = limit;
      }

      if (input.closingDay !== undefined) {
        if (!isCycleDay(input.closingDay)) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Closing day must be an integer between 1 and 31",
          );
        }
        this._closingDay = input.closingDay;
      }

      if (input.dueDay !== undefined) {
        if (!isCycleDay(input.dueDay)) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Due day must be an integer between 1 and 31",
          );
        }
        this._dueDay = input.dueDay;
      }
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    if (nextLimit && !nextLimit.equals(this._limit ?? Money.zero(this._currency))) {
      const oldLimit = this._limit;
      this._limit = nextLimit;
      this.raiseEvent(
        new CardLimitChanged(this.id, this._companyId, oldLimit, nextLimit),
      );
    }

    this.setUpdatedAt();
    return Result.success(this);
  }

  /**
   * Deactivates the card. Blocked while any invoice is still open or unpaid.
   */
  deactivate(
    openInvoiceCount: number,
    unpaidInvoiceCount: number,
  ): Result<Card> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create("INVALID_OPERATION", "Card is already inactive"),
      );
    }

    if (openInvoiceCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Card has ${openInvoiceCount} open invoice(s) and cannot be deactivated`,
        ),
      );
    }

    if (unpaidInvoiceCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Card has ${unpaidInvoiceCount} unpaid invoice(s) and cannot be deactivated`,
        ),
      );
    }

    this._isActive = false;
    this.setUpdatedAt();
    this.raiseEvent(
      new CardDeactivated(this.id, this._companyId, this._accountId),
    );

    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      accountId: this._accountId,
      name: this._name,
      type: this._type,
      brand: this._brand,
      bank: this._bank,
      limit: this._limit?.amount,
      closingDay: this._closingDay,
      dueDay: this._dueDay,
      currency: this._currency,
      isActive: this._isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a card bound to an active account of the same company.
   */
  static create(input: CreateCardInput): Result<Card> {
    try {
      const account = input.account as CardAccount | undefined;
      if (!account || account.id.trim().length === 0) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "Card requires a linked account",
        );
      }

      if (account.companyId !== input.companyId) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A card can only be bound to an account of the same company",
        );
      }

      if (!account.isActive) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "A card cannot be bound to an inactive account",
        );
      }

      const currency = normalizeCurrency(account.currency);

      const card = new Card({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        accountId: account.id,
        name: input.name,
        type: input.type,
        brand: input.brand,
        bank: input.bank,
        limit:
          input.limit === undefined
            ? undefined
            : Money.create(input.limit, currency),
        closingDay: input.closingDay,
        dueDay: input.dueDay,
        currency,
      });

      card.raiseEvent(
        new CardCreated(
          card.id,
          card.companyId,
          card.accountId,
          card.name,
          card.type,
          card.brand,
          card.limit,
        ),
      );

      return Result.success(card);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
