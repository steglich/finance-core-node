import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account } from "./account.js";
import { Loan } from "./loan.js";
import type { LoanAccount } from "./loan.js";
import type { LoanInstallment } from "./loan-installment.js";
import { LoanAmortizationService } from "./loan-amortization-service.js";
import { LoanPaymentService } from "./loan-payment-service.js";
import { Money } from "./money.js";

const PAID_AT = new Date("2026-09-10T00:00:00Z");

const linkedAccount: LoanAccount = {
  id: "account-1",
  companyId: "company-1",
  currency: "BRL",
  isActive: true,
};

function account(
  balance: number,
  overrides: { currency?: string; isActive?: boolean } = {},
): Account {
  const result = Account.create({
    id: "account-1",
    companyId: "company-1",
    walletId: "wallet-1",
    name: "Conta Corrente",
    number: "1234",
    type: "CHECKING",
    currency: overrides.currency ?? "BRL",
    initialBalance: balance,
  });

  assert.ok(result.value);
  result.value.clearEvents();

  if (overrides.isActive === false) {
    result.value.deactivate(0);
    result.value.clearEvents();
  }

  return result.value;
}

/**
 * A loan of R$ 10.000,00 in 24 × R$ 520,00 at 1,5% a.m. — the case in the spec.
 */
function contractedLoan(
  overrides: {
    principalAmount?: number;
    installmentCount?: number;
    installmentAmount?: number;
    monthlyInterestPercent?: number;
  } = {},
): { loan: Loan; installments: LoanInstallment[] } {
  const result = Loan.contract({
    companyId: "company-1",
    account: linkedAccount,
    description: "Empréstimo capital de giro",
    principalAmount: overrides.principalAmount ?? 10000,
    monthlyInterestPercent: overrides.monthlyInterestPercent ?? 1.5,
    installmentCount: overrides.installmentCount ?? 24,
    installmentAmount: overrides.installmentAmount ?? 520,
    firstDueDate: PAID_AT,
  });

  assert.ok(result.value, result.error?.message ?? "");
  result.value.loan.clearEvents();
  return result.value;
}

const paymentService = new LoanPaymentService();
const amortizationService = new LoanAmortizationService();

function pay(
  loan: Loan,
  installments: LoanInstallment[],
  index: number,
  balance = 100000,
  accountOverrides: { currency?: string; isActive?: boolean } = {},
) {
  const installment = installments[index];
  assert.ok(installment);

  return paymentService.pay({
    loan,
    installment,
    installments,
    account: account(balance, accountOverrides),
    amount: installment.amount.amount,
    paidAt: PAID_AT,
  });
}

describe("LoanPaymentService.pay", () => {
  it("pays an installment on time and starts the loan", () => {
    const { loan, installments } = contractedLoan();

    const result = pay(loan, installments, 0);

    assert.ok(result.value, result.error?.message ?? "");
    const { payment, installment } = result.value;

    assert.equal(payment.type, "EXPENSE");
    assert.equal(payment.status, "CONFIRMED");
    assert.equal(payment.grossAmount.amount, 520);
    assert.equal(payment.loanInstallmentId, installment.id);
    assert.equal(installment.status, "PAID");
    assert.equal(loan.status, "IN_PROGRESS");
    assert.equal(result.value.settled, false);
  });

  it("settles the loan when the last open installment is paid", () => {
    const { loan, installments } = contractedLoan({
      principalAmount: 1000,
      installmentCount: 2,
      installmentAmount: 520,
      monthlyInterestPercent: 0,
    });

    const first = pay(loan, installments, 0);
    assert.ok(first.value, first.error?.message ?? "");
    assert.equal(loan.status, "IN_PROGRESS");

    const second = pay(loan, installments, 1);
    assert.ok(second.value, second.error?.message ?? "");

    assert.equal(second.value.settled, true);
    assert.equal(loan.status, "SETTLED");
    assert.ok(
      second.value.events
        .map((event) => event.getEventType())
        .includes("LoanSettled"),
    );
  });

  it("regularizes a delinquent loan when no overdue installment remains", () => {
    const { loan, installments } = contractedLoan();

    // The first installment falls overdue and the loan becomes delinquent.
    const overdue = installments[0];
    assert.ok(overdue);
    assert.equal(
      overdue.markOverdue(new Date("2026-10-01T00:00:00Z")).isSuccess,
      true,
    );
    assert.equal(loan.markDelinquent().isSuccess, true);

    const result = pay(loan, installments, 0);

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(loan.status, "IN_PROGRESS");
  });

  it("keeps the loan delinquent while another installment is still overdue", () => {
    const { loan, installments } = contractedLoan();

    for (const index of [0, 1]) {
      const installment = installments[index];
      assert.ok(installment);
      installment.markOverdue(new Date("2026-12-01T00:00:00Z"));
    }
    loan.markDelinquent();

    const result = pay(loan, installments, 0);

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(loan.status, "DELINQUENT");
  });

  it("rejects a second payment of the same installment", () => {
    const { loan, installments } = contractedLoan();

    assert.equal(pay(loan, installments, 0).isSuccess, true);
    const second = pay(loan, installments, 0);

    assert.equal(second.isFailure, true);
    assert.match(second.error?.message ?? "", /already PAID/);
  });

  it("rejects a payment from an account without balance", () => {
    const { loan, installments } = contractedLoan();

    const result = pay(loan, installments, 0, 100);

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Saldo insuficiente/);
  });

  it("rejects a payment from an inactive account", () => {
    const { loan, installments } = contractedLoan();

    const result = pay(loan, installments, 0, 100000, { isActive: false });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Inactive accounts/);
  });

  it("rejects a payment from an account in another currency", () => {
    const { loan, installments } = contractedLoan();

    const result = pay(loan, installments, 0, 100000, { currency: "USD" });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /does not match loan currency/);
  });

  it("rejects a payment on a settled loan", () => {
    const { loan, installments } = contractedLoan();
    loan.start();
    loan.settle();
    loan.clearEvents();

    const result = pay(loan, installments, 0);

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /settled loan/);
  });
});

describe("LoanAmortizationService.amortize", () => {
  function inProgressLoan(): {
    loan: Loan;
    installments: LoanInstallment[];
  } {
    const contracted = contractedLoan({
      principalAmount: 8000,
      installmentCount: 16,
      installmentAmount: 520,
      monthlyInterestPercent: 0,
    });
    assert.equal(contracted.loan.start().isSuccess, true);
    return contracted;
  }

  it("reduces an R$ 8.000,00 balance to R$ 6.000,00 with a R$ 2.000,00 amortization", () => {
    const { loan, installments } = inProgressLoan();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100000),
      amount: 2000,
      paidAt: PAID_AT,
    });

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.payment.type, "EXPENSE");
    assert.equal(result.value.payment.status, "CONFIRMED");
    assert.equal(result.value.payment.grossAmount.amount, 2000);

    const balance = loan.balanceFrom(installments);
    assert.equal(balance.outstandingBalance.amount, 6000);
  });

  it("settles the loan when the amortization covers the whole balance", () => {
    const { loan, installments } = inProgressLoan();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100000),
      amount: 8000,
      paidAt: PAID_AT,
    });

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.settled, true);
    assert.equal(loan.status, "SETTLED");
    assert.ok(installments.every((installment) => installment.isPaid));
  });

  it("settles installments from the last one backwards", () => {
    const { loan, installments } = inProgressLoan();

    // At 0% interest each of the first 15 installments repays R$ 520,00 of
    // principal and the last one absorbs the remaining R$ 200,00.
    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100000),
      amount: 1000,
      paidAt: PAID_AT,
    });

    assert.ok(result.value, result.error?.message ?? "");
    const settledNumbers = result.value.settledInstallments
      .map((installment) => installment.number)
      .sort((a, b) => a - b);

    // R$ 1.000,00 clears the 16th (R$ 200,00) and the 15th (R$ 520,00), with
    // R$ 280,00 left to shrink the 14th.
    assert.deepEqual(settledNumbers, [15, 16]);
    const first = installments[0];
    assert.ok(first);
    assert.equal(first.status, "PENDING");
  });

  it("reduces the principal of the last pending installment with the remainder", () => {
    const { loan, installments } = inProgressLoan();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100000),
      amount: 700,
      paidAt: PAID_AT,
    });

    assert.ok(result.value, result.error?.message ?? "");
    // R$ 700 clears the 16th (R$ 200,00) and takes R$ 500,00 off the 15th's
    // R$ 520,00 principal portion, leaving R$ 20,00 of it open.
    assert.equal(result.value.settledInstallments.length, 1);
    assert.equal(result.value.reducedInstallment?.number, 15);
    assert.equal(result.value.reducedInstallment?.principalAmount.amount, 20);
  });

  it("rejects an amortization larger than the outstanding balance", () => {
    const { loan, installments } = inProgressLoan();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100000),
      amount: 9000,
      paidAt: PAID_AT,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /exceeds the outstanding balance/);
  });

  it("rejects an amortization on a settled loan", () => {
    const { loan, installments } = inProgressLoan();
    loan.settle();
    loan.clearEvents();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(0, "BRL"),
      account: account(100000),
      amount: 100,
      paidAt: PAID_AT,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /settled loan/);
  });

  it("rejects an amortization from an inactive account", () => {
    const { loan, installments } = inProgressLoan();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100000, { isActive: false }),
      amount: 1000,
      paidAt: PAID_AT,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Inactive accounts/);
  });

  it("rejects an amortization from an account in another currency", () => {
    const { loan, installments } = inProgressLoan();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100000, { currency: "USD" }),
      amount: 1000,
      paidAt: PAID_AT,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /does not match loan currency/);
  });

  it("rejects an amortization from an account without balance", () => {
    const { loan, installments } = inProgressLoan();

    const result = amortizationService.amortize({
      loan,
      installments,
      outstandingBalance: Money.create(8000, "BRL"),
      account: account(100),
      amount: 1000,
      paidAt: PAID_AT,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Saldo insuficiente/);
  });
});
