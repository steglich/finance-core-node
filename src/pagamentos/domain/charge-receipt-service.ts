import { randomUUID } from "node:crypto";
import type { Account } from "../../financeiro/domain/account.js";
import { Money } from "../../financeiro/domain/money.js";
import { Transaction } from "../../financeiro/domain/transaction.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Result } from "../../shared/domain/result.js";
import type { Charge } from "./charge.js";

/**
 * Input for registering the receipt of a charge.
 */
export interface ReceiveChargeInput {
  charge: Charge;
  /** Account the money lands in. */
  account: Account;
  /** Amount in the charge currency; must equal the total due at `receivedAt`. */
  amount: number;
  /**
   * Receipt date. Required rather than defaulted, because the total due is a
   * function of it — see the charge math.
   */
  receivedAt: Date;
  costCenterId?: string | undefined;
  categoryId?: string | undefined;
  description?: string | undefined;
}

/**
 * Outcome of a receipt: the settled charge plus the confirmed income
 * transaction the caller must persist and post to the account, in one database
 * transaction.
 */
export interface ReceiveChargeResult {
  charge: Charge;
  payment: Transaction;
  receiptId: string;
  amount: Money;
  penalty: Money;
  interest: Money;
  receivedAt: Date;
  events: readonly DomainEvent<string>[];
}

/**
 * Domain service that settles a charge.
 *
 * Pure, in the shape of `InvoicePaymentService.pay()`: it receives hydrated
 * aggregates, validates them together, builds the pieces and returns them. It
 * holds no repository and opens no database transaction — the controller does
 * that, so the atomic write lives in exactly one place.
 */
export class ChargeReceiptService {
  receive(input: ReceiveChargeInput): Result<ReceiveChargeResult> {
    const { charge, account, receivedAt } = input;

    if (account.companyId !== charge.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A charge can only be received into an account of the same company",
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

    if (account.currency !== charge.currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Destination account currency ${account.currency} does not match charge currency ${charge.currency}`,
        ),
      );
    }

    let amount: Money;
    try {
      amount = Money.create(input.amount, charge.currency);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    if (!amount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "The received amount must be greater than zero",
        ),
      );
    }

    // Built before the state transition, so a transaction that cannot be
    // created leaves the charge untouched.
    const transaction = Transaction.create({
      companyId: charge.companyId,
      accountId: account.id,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
      personId: charge.personId,
      type: "INCOME",
      grossAmount: amount.amount,
      currency: charge.currency,
      accountCurrency: account.currency,
      date: receivedAt,
      description: input.description ?? `Recebimento da cobrança ${charge.id}`,
    });

    if (transaction.isFailure || !transaction.value) {
      return Result.failed(
        transaction.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not build the receipt transaction",
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
            "Could not confirm the receipt transaction",
          ),
      );
    }

    // The charge itself checks the amount against the total due for this exact
    // date, penalty and interest included.
    const registered = charge.registerReceipt(amount, receivedAt);
    if (registered.isFailure || !registered.value) {
      return Result.failed(
        registered.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not register the receipt",
          ),
      );
    }

    const due = registered.value;

    return Result.success({
      charge,
      payment,
      receiptId: randomUUID(),
      amount,
      penalty: due.penalty,
      interest: due.interest,
      receivedAt,
      events: [...payment.events, ...charge.events],
    });
  }
}
