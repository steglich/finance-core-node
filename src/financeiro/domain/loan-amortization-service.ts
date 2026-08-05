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
export interface AmortizeLoanInput {
  loan: Loan;
  /** The whole schedule — the amortization decides which lines it settles. */
  installments: readonly LoanInstallment[];
  /** The outstanding balance, derived by the caller from the same schedule. */
  outstandingBalance: Money;
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
export interface AmortizeLoanResult {
  loan: Loan;
  payment: Transaction;
  paymentId: string;
  amount: Money;
  paidAt: Date;
  /** Installments the amortization settled outright. */
  settledInstallments: LoanInstallment[];
  /** The installment whose principal portion was partially reduced, if any. */
  reducedInstallment?: LoanInstallment | undefined;
  /** True when the amortization covered the whole outstanding balance. */
  settled: boolean;
  events: readonly DomainEvent<string>[];
}

/**
 * Domain service that registers an extra amortization on a loan.
 *
 * The amortization reduces the outstanding balance by the whole informed
 * amount, settling pending installments **from the last one backwards** — that
 * is what shortens the loan rather than lowering the installment. When it does
 * not cover a whole installment, the remainder reduces the principal portion of
 * the last still-pending one.
 *
 * This is a repayment, not a renegotiation: the rate is not recomputed
 * (declared as a non-goal in the design).
 */
export class LoanAmortizationService {
  amortize(input: AmortizeLoanInput): Result<AmortizeLoanResult> {
    const { loan, installments, outstandingBalance, account, paidAt } = input;

    if (loan.isSettled) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A settled loan does not accept amortizations",
        ),
      );
    }

    if (loan.status === "CONTRACTED") {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An extra amortization requires a loan in progress",
        ),
      );
    }

    if (account.companyId !== loan.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "A loan can only be amortized from an account of the same company",
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
          "The amortization amount must be greater than zero",
        ),
      );
    }

    if (amount.greaterThan(outstandingBalance)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `The amortization of ${amount.toDecimalString()} exceeds the outstanding balance of ${outstandingBalance.toDecimalString()}`,
        ),
      );
    }

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
        input.description ?? `Amortização extra de ${loan.description}`,
    });

    if (transaction.isFailure || !transaction.value) {
      return Result.failed(
        transaction.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not build the amortization transaction",
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
            "Could not confirm the amortization transaction",
          ),
      );
    }

    // From the last open installment backwards: shortening the loan is what an
    // extra amortization does.
    const open = installments
      .filter((installment) => installment.isOpen)
      .sort((a, b) => b.number - a.number);

    let remaining = amount;
    const settledInstallments: LoanInstallment[] = [];
    let reducedInstallment: LoanInstallment | undefined;

    for (const installment of open) {
      if (remaining.isZero()) {
        break;
      }

      if (remaining.greaterThanOrEqual(installment.principalAmount)) {
        const result = installment.settleByAmortization(paidAt);
        if (result.isFailure) {
          return Result.failed(
            result.error ??
              DomainError.create(
                "BUSINESS_RULE_VIOLATION",
                "Could not settle the installment",
              ),
          );
        }
        remaining = remaining.subtract(installment.principalAmount);
        settledInstallments.push(installment);
        continue;
      }

      const result = installment.reducePrincipal(remaining);
      if (result.isFailure) {
        return Result.failed(
          result.error ??
            DomainError.create(
              "BUSINESS_RULE_VIOLATION",
              "Could not reduce the installment principal",
            ),
        );
      }
      reducedInstallment = installment;
      remaining = Money.zero(loan.currency);
      break;
    }

    const settled = amount.equals(outstandingBalance);

    if (settled) {
      // Everything still open is covered by this amortization.
      for (const installment of open) {
        if (installment.isOpen) {
          const result = installment.settleByAmortization(paidAt);
          if (result.isSuccess) {
            settledInstallments.push(installment);
          }
        }
      }
      if (reducedInstallment && reducedInstallment.isPaid) {
        reducedInstallment = undefined;
      }

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
    }

    return Result.success({
      loan,
      payment,
      paymentId: randomUUID(),
      amount,
      paidAt,
      settledInstallments,
      reducedInstallment,
      settled,
      events: [...payment.events, ...loan.events],
    });
  }
}
