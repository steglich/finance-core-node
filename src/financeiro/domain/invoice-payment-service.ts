import { randomUUID } from "node:crypto";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Result } from "../../shared/domain/result.js";
import type { Account } from "./account.js";
import type { Invoice } from "./invoice.js";
import { Money } from "./money.js";
import { Transaction } from "./transaction.js";

/**
 * Input for paying a closed, partially paid or overdue invoice.
 */
export interface PayInvoiceInput {
  invoice: Invoice;
  /** Account the money comes from; may differ from the card's account. */
  account: Account;
  /** Amount in the invoice currency. */
  amount: number;
  date?: Date;
  categoryId?: string | undefined;
  description?: string | undefined;
}

/**
 * Outcome of a payment: the transitioned invoice plus the confirmed expense
 * transaction the caller must persist and post to the account, in one database
 * transaction.
 */
export interface PayInvoiceResult {
  invoice: Invoice;
  payment: Transaction;
  paymentId: string;
  amount: Money;
  paidAt: Date;
  events: readonly DomainEvent<string>[];
}

/**
 * Domain service that orchestrates the payment of an invoice.
 *
 * RN-08: the obligation is the invoice, not each purchase — this is the single
 * point where a credit card charge reaches the account balance. The service
 * builds the pieces and validates them together; the caller writes them
 * atomically, exactly as `TransferService` does.
 */
export class InvoicePaymentService {
  pay(input: PayInvoiceInput): Result<PayInvoiceResult> {
    const { invoice, account } = input;

    if (account.companyId !== invoice.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "An invoice can only be paid from an account of the same company",
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

    if (account.currency !== invoice.currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment account currency ${account.currency} does not match invoice currency ${invoice.currency}`,
        ),
      );
    }

    let amount: Money;
    try {
      amount = Money.create(input.amount, invoice.currency);
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
    // invoice untouched.
    if (account.availableBalance.lessThan(amount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Saldo insuficiente na conta de pagamento",
        ),
      );
    }

    const paidAt = input.date ?? new Date();

    const transaction = Transaction.create({
      companyId: invoice.companyId,
      accountId: account.id,
      categoryId: input.categoryId,
      type: "EXPENSE",
      grossAmount: amount.amount,
      currency: invoice.currency,
      accountCurrency: account.currency,
      date: paidAt,
      description: input.description ?? `Pagamento de fatura ${invoice.id}`,
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

    const registered = invoice.registerPayment(amount, paidAt);
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
      invoice,
      payment,
      paymentId: randomUUID(),
      amount,
      paidAt,
      events: [...payment.events, ...invoice.events],
    });
  }
}
