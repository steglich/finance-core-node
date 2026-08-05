import { randomUUID } from "node:crypto";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Result } from "../../shared/domain/result.js";
import type { Account } from "./account.js";
import type { Loan } from "./loan.js";
import type { LoanInstallment } from "./loan-installment.js";
import { Money } from "./money.js";
import { Transaction } from "./transaction.js";

/**
 * Everything the service needs, already hydrated by the caller.
 */
export interface PayLoanInstallmentInput {
  loan: Loan;
  installment: LoanInstallment;
  /** The whole schedule, needed to decide settlement and regularization. */
  installments: readonly LoanInstallment[];
  /** Account the money comes from. */
  account: Account;
  amount: number;
  paidAt: Date;
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  description?: string | undefined;
}

/**
 * The pieces the caller must persist in a single database transaction.
 */
export interface PayLoanInstallmentResult {
  loan: Loan;
  installment: LoanInstallment;
  payment: Transaction;
  paymentId: string;
  amount: Money;
  paidAt: Date;
  /** True when this payment settled the loan. */
  settled: boolean;
  events: readonly DomainEvent<string>[];
}

/**
 * Domain service that pays one installment of a loan.
 *
 * Pure, in the shape of `ChargeReceiptService`: it validates, builds the
 * confirmed expense transaction, transitions the installment and the loan —
 * including the regularization of a delinquent loan whose last overdue
 * installment this payment clears — and returns the pieces. The controller owns
 * the atomic write, and the repository's status-guarded UPDATE is what makes a
 * concurrent second payment impossible (design, decision 7).
 */
export class LoanPaymentService {
  pay(input: PayLoanInstallmentInput): Result<PayLoanInstallmentResult> {
    const { loan, installment, installments, account, paidAt } = input;

    if (loan.isSettled) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A settled loan does not accept new payments",
        ),
      );
    }

    if (installment.loanId !== loan.id) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "The installment does not belong to this loan",
        ),
      );
    }

    if (account.companyId !== loan.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A loan installment can only be paid from an account of the same company",
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

    if (account.currency !== loan.currency) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Payment account currency ${account.currency} does not match loan currency ${loan.currency}`,
        ),
      );
    }

    let amount: Money;
    try {
      amount = Money.create(input.amount, loan.currency);
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
    // installment untouched.
    if (account.availableBalance.lessThan(amount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Saldo insuficiente na conta de pagamento",
        ),
      );
    }

    const transaction = Transaction.create({
      companyId: loan.companyId,
      accountId: account.id,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
      personId: loan.personId,
      type: "EXPENSE",
      grossAmount: amount.amount,
      currency: loan.currency,
      accountCurrency: account.currency,
      date: paidAt,
      description:
        input.description ??
        `Parcela ${installment.number} de ${loan.description}`,
      loanInstallmentId: installment.id,
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

    const registered = installment.registerPayment(amount, paidAt);
    if (registered.isFailure) {
      return Result.failed(
        registered.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not register the installment payment",
          ),
      );
    }

    // The first payment starts the loan; a loan that had not started yet cannot
    // reach Settled without passing through In Progress, which is exactly what
    // the state machine enforces.
    if (loan.status === "CONTRACTED") {
      const started = loan.start();
      if (started.isFailure) {
        return Result.failed(
          started.error ??
            DomainError.create(
              "INVALID_OPERATION",
              "Could not start the loan",
            ),
        );
      }
    }

    const remaining = installments.filter(
      (candidate) => candidate.id !== installment.id && candidate.isOpen,
    );

    let settled = false;

    if (remaining.length === 0) {
      const result = loan.settle(paidAt);
      if (result.isFailure) {
        return Result.failed(
          result.error ??
            DomainError.create(
              "INVALID_OPERATION",
              "Could not settle the loan",
            ),
        );
      }
      settled = true;
    } else if (
      loan.status === "DELINQUENT" &&
      remaining.every((candidate) => candidate.status !== "OVERDUE")
    ) {
      // Regularization is not a scheduler pass: it happens here, the moment the
      // last overdue installment is cleared.
      const result = loan.regularize();
      if (result.isFailure) {
        return Result.failed(
          result.error ??
            DomainError.create(
              "INVALID_OPERATION",
              "Could not regularize the loan",
            ),
        );
      }
    }

    return Result.success({
      loan,
      installment,
      payment,
      paymentId: randomUUID(),
      amount,
      paidAt,
      settled,
      events: [...payment.events, ...loan.events],
    });
  }
}
