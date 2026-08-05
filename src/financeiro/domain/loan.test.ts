import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Loan } from "./loan.js";
import type { LoanAccount, LoanStatus } from "./loan.js";
import type { LoanInstallment } from "./loan-installment.js";
import { Money } from "./money.js";

const account: LoanAccount = {
  id: "account-1",
  companyId: "company-1",
  currency: "BRL",
  isActive: true,
};

function contract(
  overrides: {
    principalAmount?: number;
    monthlyInterestPercent?: number;
    installmentCount?: number;
    installmentAmount?: number;
    creditorCompanyId?: string;
  } = {},
) {
  return Loan.contract({
    companyId: "company-1",
    account,
    creditor: overrides.creditorCompanyId
      ? { id: "person-1", companyId: overrides.creditorCompanyId }
      : undefined,
    description: "Empréstimo capital de giro",
    principalAmount: overrides.principalAmount ?? 10000,
    monthlyInterestPercent: overrides.monthlyInterestPercent ?? 1.5,
    installmentCount: overrides.installmentCount ?? 24,
    installmentAmount: overrides.installmentAmount ?? 520,
    firstDueDate: new Date("2026-09-10T00:00:00Z"),
  });
}

function contractedLoan(): { loan: Loan; installments: LoanInstallment[] } {
  const result = contract();
  assert.ok(result.value, result.error?.message ?? "");
  result.value.loan.clearEvents();
  return result.value;
}

/**
 * Walks the loan to a status through the transitions the machine allows.
 */
function advanceTo(loan: Loan, status: LoanStatus): void {
  if (status === "CONTRACTED") return;
  assert.equal(loan.start().isSuccess, true);
  if (status === "IN_PROGRESS") return;
  if (status === "DELINQUENT") {
    assert.equal(loan.markDelinquent().isSuccess, true);
    return;
  }
  assert.equal(loan.settle().isSuccess, true);
}

describe("Loan.contract", () => {
  it("contracts a loan and generates its 24 pending installments", () => {
    const result = contract();

    assert.ok(result.value, result.error?.message ?? "");
    const { loan, installments } = result.value;

    assert.equal(loan.status, "CONTRACTED");
    assert.equal(loan.currency, "BRL");
    assert.equal(installments.length, 24);
    assert.ok(installments.every((installment) => installment.status === "PENDING"));
    assert.deepEqual(
      loan.events.map((event) => event.getEventType()),
      ["LoanCreated"],
    );
  });

  it("rejects a non-positive principal", () => {
    const result = contract({ principalAmount: 0 });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /principal must be greater/);
  });

  it("rejects an interest rate out of range", () => {
    const result = contract({ monthlyInterestPercent: 150 });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /between 0% and 100%/);
  });

  it("rejects a schedule that does not repay the principal", () => {
    const result = contract({ installmentCount: 10, installmentAmount: 500 });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /does not repay the principal/);
  });

  it("rejects a creditor of another company", () => {
    const result = contract({ creditorCompanyId: "company-2" });

    assert.equal(result.isFailure, true);
    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("rejects a non-positive number of installments", () => {
    const result = contract({ installmentCount: 0 });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /number of installments/);
  });
});

describe("Loan state machine", () => {
  it("moves from Contracted to In Progress on the first payment", () => {
    const { loan } = contractedLoan();

    assert.equal(loan.start().isSuccess, true);
    assert.equal(loan.status, "IN_PROGRESS");
  });

  it("moves from Contracted to Delinquent when an installment falls overdue", () => {
    const { loan } = contractedLoan();

    assert.equal(loan.markDelinquent().isSuccess, true);
    assert.equal(loan.status, "DELINQUENT");
  });

  it("regularizes a delinquent loan back to In Progress", () => {
    const { loan } = contractedLoan();
    advanceTo(loan, "DELINQUENT");

    assert.equal(loan.regularize().isSuccess, true);
    assert.equal(loan.status, "IN_PROGRESS");
  });

  it("settles an in-progress loan and publishes LoanSettled", () => {
    const { loan } = contractedLoan();
    advanceTo(loan, "IN_PROGRESS");

    assert.equal(loan.settle().isSuccess, true);
    assert.equal(loan.status, "SETTLED");
    assert.deepEqual(
      loan.events.map((event) => event.getEventType()),
      ["LoanSettled"],
    );
  });

  it("settles a delinquent loan", () => {
    const { loan } = contractedLoan();
    advanceTo(loan, "DELINQUENT");

    assert.equal(loan.settle().isSuccess, true);
    assert.equal(loan.status, "SETTLED");
  });

  it("refuses to go from Contracted straight to Settled", () => {
    const { loan } = contractedLoan();

    const result = loan.settle();

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /before being settled/);
    assert.equal(loan.status, "CONTRACTED");
  });

  it("refuses every transition out of Settled", () => {
    const { loan } = contractedLoan();
    advanceTo(loan, "SETTLED");

    for (const transition of [
      () => loan.start(),
      () => loan.markDelinquent(),
      () => loan.regularize(),
      () => loan.settle(),
    ]) {
      const result = transition();
      assert.equal(result.isFailure, true);
      assert.match(result.error?.message ?? "", /cannot be reopened/);
    }

    assert.equal(loan.status, "SETTLED");
  });

  it("refuses to edit a settled loan", () => {
    const { loan } = contractedLoan();
    advanceTo(loan, "SETTLED");

    const result = loan.edit({ description: "Outro" });

    assert.equal(result.isFailure, true);
  });
});

describe("Loan.balanceFrom", () => {
  it("reports the full principal on an untouched loan", () => {
    const { loan, installments } = contractedLoan();

    const balance = loan.balanceFrom(installments);

    assert.equal(balance.outstandingBalance.amount, 10000);
    assert.equal(balance.paidInstallments, 0);
    assert.equal(balance.remainingInstallments, 24);
    assert.equal(balance.interestPaid.amount, 0);
  });

  it("reduces the balance by the principal portions paid and leaves 19 installments", () => {
    const { loan, installments } = contractedLoan();

    let amortized = 0;
    for (const installment of installments.slice(0, 5)) {
      amortized += installment.principalAmount.amount;
      assert.equal(
        installment.registerPayment(
          installment.amount,
          new Date("2026-09-10T00:00:00Z"),
        ).isSuccess,
        true,
      );
    }

    const balance = loan.balanceFrom(installments);

    assert.equal(balance.paidInstallments, 5);
    assert.equal(balance.remainingInstallments, 19);
    assert.equal(
      balance.outstandingBalance.amount,
      Math.round((10000 - amortized) * 100) / 100,
    );
  });

  it("counts an extra amortization once, through the lines it consumed", () => {
    const { loan, installments } = contractedLoan();

    // What an amortization does to the schedule: settle whole lines and shrink
    // the principal portion of the one it only partially covers.
    const last = installments[23];
    const beforeLast = installments[22];
    assert.ok(last);
    assert.ok(beforeLast);

    const settled = last.principalAmount.amount;
    assert.equal(
      last.settleByAmortization(new Date("2026-09-10T00:00:00Z")).isSuccess,
      true,
    );
    assert.equal(
      beforeLast.reducePrincipal(Money.create(100, "BRL")).isSuccess,
      true,
    );

    const balance = loan.balanceFrom(installments);

    assert.equal(
      balance.outstandingBalance.amount,
      Math.round((10000 - settled - 100) * 100) / 100,
    );
  });

  it("reports a zero balance once every installment is settled", () => {
    const { loan, installments } = contractedLoan();

    for (const installment of installments) {
      installment.settleByAmortization(new Date("2026-09-10T00:00:00Z"));
    }

    assert.equal(loan.balanceFrom(installments).outstandingBalance.amount, 0);
  });
});

describe("LoanInstallment", () => {
  it("rejects a second payment of the same installment", () => {
    const { installments } = contractedLoan();
    const installment = installments[0];
    assert.ok(installment);

    const paidAt = new Date("2026-09-10T00:00:00Z");
    assert.equal(
      installment.registerPayment(installment.amount, paidAt).isSuccess,
      true,
    );

    const second = installment.registerPayment(installment.amount, paidAt);

    assert.equal(second.isFailure, true);
    assert.match(second.error?.message ?? "", /already PAID/);
  });

  it("flags a pending installment overdue only after its due date", () => {
    const { installments } = contractedLoan();
    const installment = installments[0];
    assert.ok(installment);

    const early = installment.markOverdue(new Date("2026-09-01T00:00:00Z"));
    assert.equal(early.isFailure, true);

    const late = installment.markOverdue(new Date("2026-09-20T00:00:00Z"));
    assert.equal(late.isSuccess, true);
    assert.equal(installment.status, "OVERDUE");
    assert.equal(installment.daysLateAt(new Date("2026-09-20T00:00:00Z")), 10);
  });

  it("does not flag an already overdue installment a second time", () => {
    const { installments } = contractedLoan();
    const installment = installments[0];
    assert.ok(installment);

    installment.markOverdue(new Date("2026-09-20T00:00:00Z"));
    const again = installment.markOverdue(new Date("2026-09-20T00:00:00Z"));

    assert.equal(again.isFailure, true);
  });

  it("rejects a payment whose amount is not the installment's", () => {
    const { installments } = contractedLoan();
    const installment = installments[0];
    assert.ok(installment);

    const result = installment.registerPayment(
      Money.create(100, "BRL"),
      new Date("2026-09-10T00:00:00Z"),
    );

    assert.equal(result.isFailure, true);
  });
});
