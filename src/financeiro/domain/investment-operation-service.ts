import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Result } from "../../shared/domain/result.js";
import type { Account } from "./account.js";
import type { Investment } from "./investment.js";
import { InvestmentOperation } from "./investment-operation.js";
import { derivePosition } from "./investment-position.js";
import type { InvestmentPosition } from "./investment-position.js";
import { InvestmentOperationRegistered } from "./investment-events.js";
import { Money } from "./money.js";
import { Transaction } from "./transaction.js";

/**
 * What the caller informs when registering an operation.
 */
export interface RegisterOperationInput {
  operationType: string;
  quantity?: number | undefined;
  unitPrice?: number | undefined;
  fees?: number | undefined;
  amount?: number | undefined;
  operatedAt: Date;
  notes?: string | undefined;
  /**
   * Overrides the investment's default category. Must be of the matching type
   * and belong to the same company — checked by the caller, which loaded it.
   */
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  description?: string | undefined;
  /** Injectable "today", so a future-dated operation can be rejected in tests. */
  today?: Date | undefined;
}

/**
 * Everything the service needs, already hydrated by the caller.
 */
export interface RegisterInvestmentOperationInput {
  investment: Investment;
  /** Operations already registered, chronological — the position comes from them. */
  operations: readonly InvestmentOperation[];
  /** The investment's linked account. */
  account: Account;
  input: RegisterOperationInput;
}

/**
 * The pieces the caller must persist in a single database transaction.
 */
export interface RegisterInvestmentOperationResult {
  operation: InvestmentOperation;
  payment: Transaction;
  /** The position after the operation, so the caller can answer with it. */
  position: InvestmentPosition;
  events: readonly DomainEvent<string>[];
}

/**
 * Domain service that registers an operation on an investment.
 *
 * Pure, in the shape of `ChargeReceiptService`: it receives hydrated
 * aggregates, validates them together, builds the operation and the confirmed
 * transaction that moves the account, and hands the pieces back. It holds no
 * repository and opens no database transaction — the controller does that, so
 * the atomic write lives in exactly one place.
 */
export class InvestmentOperationService {
  register(
    args: RegisterInvestmentOperationInput,
  ): Result<RegisterInvestmentOperationResult> {
    const { investment, operations, account, input } = args;

    const closed = investment.ensureAcceptsOperations();
    if (closed) {
      return Result.failed(closed);
    }

    if (account.companyId !== investment.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "An investment operation can only settle through an account of the same company",
        ),
      );
    }

    if (account.id !== investment.accountId) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "An investment operation must settle through the investment's linked account",
        ),
      );
    }

    if (!account.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Inactive accounts do not accept new transactions",
        ),
      );
    }

    if (account.currency !== investment.currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Account currency ${account.currency} does not match investment currency ${investment.currency}`,
        ),
      );
    }

    const created = InvestmentOperation.create({
      companyId: investment.companyId,
      investmentId: investment.id,
      operationType: input.operationType,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      fees: input.fees,
      amount: input.amount,
      currency: investment.currency,
      operatedAt: input.operatedAt,
      notes: input.notes,
      today: input.today,
    });

    if (created.isFailure || !created.value) {
      return Result.failed(
        created.error ??
          DomainError.create(
            "VALIDATION_ERROR",
            "Could not build the investment operation",
          ),
      );
    }

    const operation = created.value;

    // The position is recomputed from the operations already stored plus this
    // one, which is what rejects a sale larger than the position. The caller
    // runs this with the investment row locked, so the sum cannot move under it.
    const position = derivePosition(
      [...operations, operation],
      investment.currency,
    );
    if (position.isFailure || !position.value) {
      return Result.failed(
        position.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not derive the investment position",
          ),
      );
    }

    const isPurchase = operation.operationType === "BUY";
    const amount: Money = operation.amount;

    // Checked before anything is built, so a rejected purchase leaves nothing.
    if (isPurchase && account.availableBalance.lessThan(amount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Saldo insuficiente na conta do investimento",
        ),
      );
    }

    const categoryId =
      input.categoryId ??
      (isPurchase
        ? investment.expenseCategoryId
        : investment.incomeCategoryId);

    const transaction = Transaction.create({
      companyId: investment.companyId,
      accountId: account.id,
      categoryId,
      costCenterId: input.costCenterId,
      type: isPurchase ? "EXPENSE" : "INCOME",
      grossAmount: amount.amount,
      currency: investment.currency,
      accountCurrency: account.currency,
      date: operation.operatedAt,
      description:
        input.description ??
        `${operation.operationType} de ${investment.name}`,
      investmentOperationId: operation.id,
    });

    if (transaction.isFailure || !transaction.value) {
      return Result.failed(
        transaction.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not build the operation transaction",
          ),
      );
    }

    const payment = transaction.value;
    const confirmed = payment.confirm();
    if (confirmed.isFailure) {
      return Result.failed(
        confirmed.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not confirm the operation transaction",
          ),
      );
    }

    operation.linkToTransaction(payment.id);

    const registered = new InvestmentOperationRegistered(
      investment.id,
      investment.companyId,
      operation.id,
      operation.operationType,
      operation.quantity,
      amount,
      operation.operatedAt,
      payment.id,
    );

    return Result.success({
      operation,
      payment,
      position: position.value,
      events: [...payment.events, registered],
    });
  }
}
