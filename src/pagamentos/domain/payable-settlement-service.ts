import { randomUUID } from "node:crypto";
import type { Account } from "../../financeiro/domain/account.js";
import { Money } from "../../financeiro/domain/money.js";
import { Transaction } from "../../financeiro/domain/transaction.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Result } from "../../shared/domain/result.js";
import type { Payable } from "./payable.js";

/**
 * Input for settling a payable.
 */
export interface SettlePayableInput {
  payable: Payable;
  /** Account the money comes from. */
  account: Account;
  /** Amount in the payable currency; must equal the amount owed. */
  amount: number;
  paidAt: Date;
  description?: string | undefined;
}

/**
 * Outcome of a settlement: the settled payable plus the confirmed expense
 * transaction the caller must persist and post to the account, in one database
 * transaction.
 */
export interface SettlePayableResult {
  payable: Payable;
  payment: Transaction;
  paymentId: string;
  amount: Money;
  paidAt: Date;
  events: readonly DomainEvent<string>[];
}

/**
 * Domain service that settles a payable.
 *
 * The mirror of `ChargeReceiptService`, and pure in the same way: it validates,
 * builds the expense transaction inheriting the payable's category, cost center
 * and supplier, transitions the aggregate and hands the pieces back.
 */
export class PayableSettlementService {
  settle(input: SettlePayableInput): Result<SettlePayableResult> {
    const { payable, account, paidAt } = input;

    if (account.companyId !== payable.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A payable can only be settled from an account of the same company",
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

    if (account.currency !== payable.currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment account currency ${account.currency} does not match payable currency ${payable.currency}`,
        ),
      );
    }

    let amount: Money;
    try {
      amount = Money.create(input.amount, payable.currency);
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
          "The payment amount must be greater than zero",
        ),
      );
    }

    // Checked before the state transition so a rejected payment leaves the
    // payable untouched.
    if (account.availableBalance.lessThan(amount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Saldo insuficiente na conta de pagamento",
        ),
      );
    }

    const transaction = Transaction.create({
      companyId: payable.companyId,
      accountId: account.id,
      categoryId: payable.categoryId,
      costCenterId: payable.costCenterId,
      personId: payable.personId,
      type: "EXPENSE",
      grossAmount: amount.amount,
      currency: payable.currency,
      accountCurrency: account.currency,
      date: paidAt,
      competence: payable.competenceDate,
      description: input.description ?? `Pagamento da conta ${payable.id}`,
    });

    if (transaction.isFailure || !transaction.value) {
      return Result.failed(
        transaction.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not build the payment transaction",
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
            "Could not confirm the payment transaction",
          ),
      );
    }

    const registered = payable.registerPayment(amount, paidAt);
    if (registered.isFailure) {
      return Result.failed(
        registered.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not register the payment",
          ),
      );
    }

    return Result.success({
      payable,
      payment,
      paymentId: randomUUID(),
      amount,
      paidAt,
      events: [...payment.events, ...payable.events],
    });
  }
}
